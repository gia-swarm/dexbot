#!/usr/bin/env bun
/**
 * Asks Tim for everything DexBot's deploy needs that only Tim has, once.
 *
 * - Settings that aren't secret (the Cloudflare account, the domains, the
 *   Privy app id) are written into `deployments/dexbot.json`, to be committed.
 * - Secrets are typed without echo and handed to `gh secret set` on stdin, in
 *   the repository's `production` environment. They are never printed, logged
 *   or written to disk. A secret already set is kept unless you choose to
 *   replace it.
 * - DexBot's own random secrets are minted by `scripts/mint-secrets.ts`, which
 *   this runs first.
 *
 * Run it from a terminal:
 *
 *   bun run setup              # ask, then write and set
 *   bun run setup --dry-run    # ask, then show what would change
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PROFILE_PATH = join(ROOT, "deployments", "dexbot.json");
const REPO = "gia-swarm/dexbot";
const ENV = "production";
const DRY_RUN = process.argv.includes("--dry-run");

if (!process.stdin.isTTY) {
  console.error("Run this from a terminal: it asks questions and hides what you type.");
  process.exit(1);
}

/* ── Terminal ─────────────────────────────────────────────────────────── */

const lines = console[Symbol.asyncIterator]();

async function readLine(): Promise<string> {
  const next = await lines.next();
  if (next.done) throw new Error("input ended");
  return next.value;
}

async function ask(question: string, fallback?: string): Promise<string> {
  process.stdout.write(`${question}${fallback ? ` [${fallback}]` : ""}: `);
  const answer = (await readLine()).trim();
  return answer || fallback || "";
}

async function askValid(
  question: string,
  valid: (value: string) => boolean,
  problem: string,
  fallback?: string,
): Promise<string> {
  for (;;) {
    const answer = await ask(question, fallback);
    if (valid(answer)) return answer;
    console.log(`  ${problem}`);
  }
}

function echo(on: boolean) {
  Bun.spawnSync(["stty", on ? "echo" : "-echo"], { stdin: "inherit" });
}

/**
 * A secret, typed or pasted without echo. A PEM block is read until its END
 * line, so a pasted key keeps its newlines. `@path` reads a file instead.
 */
async function askSecret(question: string): Promise<string> {
  process.stdout.write(`${question} (hidden; Enter to skip, @path to read a file): `);
  echo(false);
  try {
    let value = (await readLine()).trim();
    if (value.startsWith("-----BEGIN")) {
      const block = [value];
      while (!block.at(-1)!.startsWith("-----END")) block.push((await readLine()).trim());
      value = block.join("\n");
    }
    if (value.startsWith("@")) {
      const path = value.slice(1).replace(/^~(?=\/)/, process.env.HOME ?? "~");
      value = readFileSync(path, "utf8").trim();
    }
    return value;
  } finally {
    echo(true);
    process.stdout.write("\n");
  }
}

process.on("exit", () => echo(true));
process.on("SIGINT", () => {
  echo(true);
  process.exit(130);
});

/* ── GitHub ───────────────────────────────────────────────────────────── */

function gh(args: string[], stdin?: string): string {
  const result = Bun.spawnSync({
    cmd: ["gh", ...args],
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function secretNames(): Set<string> {
  try {
    const listed = JSON.parse(gh(["secret", "list", "-R", REPO, "-e", ENV, "--json", "name"])) as {
      name: string;
    }[];
    return new Set(listed.map((secret) => secret.name));
  } catch {
    return new Set();
  }
}

const pending: { name: string; value: string }[] = [];

interface SecretQuestionV1 {
  name: string;
  what: string;
  required: boolean;
  check?: (value: string) => Promise<string | null> | string | null;
}

async function collectSecret(question: SecretQuestionV1, existing: Set<string>) {
  console.log(`\n${question.name}${question.required ? "" : " (optional)"}\n  ${question.what}`);
  if (existing.has(question.name)) {
    const replace = await ask("  Already set. Replace it? (y/N)", "n");
    if (!/^y/i.test(replace)) return;
  }
  for (;;) {
    const value = await askSecret("  Value");
    if (!value) {
      if (question.required) console.log("  Skipped. The deploy check will refuse to deploy until it's set.");
      return;
    }
    const problem = await question.check?.(value);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    pending.push({ name: question.name, value });
    console.log("  Got it.");
    return;
  }
}

/* ── Checks ───────────────────────────────────────────────────────────── */

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

async function checkCloudflareToken(accountId: string, token: string): Promise<string | null> {
  try {
    const verify = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (verify.ok) return null;
    // A user-owned token verifies at the user endpoint instead.
    const user = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { authorization: `Bearer ${token}` },
    });
    return user.ok ? null : "Cloudflare doesn't accept that token for this account. Check it and try again.";
  } catch {
    return null; // Offline: take it as given; the deploy will say if it's wrong.
  }
}

function checkJson(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { type?: string; private_key?: string };
    return parsed.type === "service_account" && parsed.private_key
      ? null
      : "That isn't a Firebase service-account JSON. Use @path to the downloaded file.";
  } catch {
    return "That isn't JSON. Use @path to the downloaded service-account file.";
  }
}

function checkPem(value: string): string | null {
  return /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/.test(value.replaceAll("\\n", "\n"))
    ? null
    : "That isn't the verification key. Paste the whole block from Privy, BEGIN and END lines included.";
}

/* ── The questions ────────────────────────────────────────────────────── */

type Profile = {
  accountId: string;
  authEnvironment: { vars: Record<string, string> };
  workers: { app: { hostnames?: string[] } };
  [key: string]: unknown;
};
const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as Profile;
const placeholder = (value: string | undefined) => !value || /^0+$|pending/.test(value);

console.log(`DexBot setup${DRY_RUN ? " (dry run: nothing is written or set)" : ""}

Settings go into deployments/dexbot.json; secrets go into GitHub's
${REPO} "${ENV}" environment and nowhere else. Enter keeps the value in
brackets.`);

console.log("\n── DexBot's own secrets ──");
if (DRY_RUN) console.log("  Would run scripts/mint-secrets.ts (skips any already set).");
else {
  const minted = Bun.spawnSync(["bun", join(ROOT, "scripts", "mint-secrets.ts")], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (minted.exitCode !== 0) process.exit(minted.exitCode ?? 1);
}
const existing = secretNames();

console.log("\n── Cloudflare ──");
const accountId = await askValid(
  "Account id (Cloudflare dashboard → Workers & Pages → Account details)",
  (value) => /^[0-9a-f]{32}$/.test(value),
  "An account id is 32 lowercase hex characters.",
  placeholder(profile.accountId) ? "1b50385fd0d4b489f7a5c240e30cee77" : profile.accountId,
);
const appHost = await askValid(
  "App domain (its zone must be on that account; ui.<domain> must stay free)",
  (value) => HOSTNAME.test(value),
  "That isn't a hostname, e.g. bot.dexfi.com.",
  profile.workers.app.hostnames?.[0] ?? "bot.dexfi.com",
);
const marketingHost = await askValid(
  "Marketing site domain",
  (value) => HOSTNAME.test(value) && value !== appHost,
  "That isn't a hostname, or it's the app's.",
  "dexbot.dexfi.com",
);
await collectSecret(
  {
    name: "CLOUDFLARE_API_TOKEN",
    what: 'Deploys every Worker. Dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template, plus Account: Workers R2 Storage, Vectorize and Containers (Edit), scoped to this account and zone.',
    required: true,
    check: (value) => checkCloudflareToken(accountId, value),
  },
  existing,
);

console.log("\n── Privy ──");
console.log(
  "  In the Privy dashboard: Discord as the only login method (no email, no wallets),\n" +
    '  "Return user data in an identity token" on, and https://' +
    appHost +
    " in allowed domains\n  and allowed OAuth redirect URLs.",
);
const privyAppId = await askValid(
  "Privy App ID (Settings → Basics)",
  (value) => /^[a-z0-9]{10,40}$/i.test(value),
  "That doesn't look like a Privy App ID.",
  placeholder(profile.authEnvironment.vars.PRIVY_APP_ID) ? undefined : profile.authEnvironment.vars.PRIVY_APP_ID,
);
await collectSecret(
  {
    name: "PRIVY_VERIFICATION_KEY",
    what: "Settings → Basics → Verification key. Paste the whole block.",
    required: true,
    check: checkPem,
  },
  existing,
);

console.log("\n── Vendor keys (FrockBot's can be reused) ──");
for (const question of [
  { name: "JEV_API_KEY", what: "TypeSafe AI's Jev: every Turn is supervised, so no Bot replies without it.", required: true },
  { name: "SPRITES_TOKEN", what: "Fly Sprites: the Computer host starts Computers with it.", required: true },
  { name: "GEMINI_API_KEY", what: "Runs voice sessions.", required: true },
  { name: "OPENAI_API_KEY", what: "Runs dictation in the composer.", required: true },
  {
    name: "FCM_SERVICE_ACCOUNT",
    what: "Firebase push. FrockBot's passes the deploy check; DexBot's own project is needed before its app gets push. Use @path to the JSON file.",
    required: true,
    check: checkJson,
  },
  { name: "COMPOSIO_API_KEY", what: "Composio connectors.", required: false },
  { name: "BRAVE_SEARCH_API_KEY", what: "Web search.", required: false },
] satisfies SecretQuestionV1[]) {
  await collectSecret(question, existing);
}

/* ── Write and set ────────────────────────────────────────────────────── */

profile.accountId = accountId;
profile.workers.app.hostnames = [appHost];
profile.authEnvironment.vars.PRIVY_APP_ID = privyAppId;
const written = `${JSON.stringify(profile, null, 2)}\n`;

console.log("\n── Summary ──");
console.log(`  deployments/dexbot.json: account ${accountId}, app on ${appHost}, Privy app ${privyAppId}`);
console.log(`  variable DEXBOT_MARKETING_HOSTNAME = ${marketingHost}`);
console.log(`  secrets: ${pending.map((secret) => secret.name).join(", ") || "none new"}`);

if (DRY_RUN) {
  console.log("\nDry run: nothing written or set.");
  process.exit(0);
}
const go = await ask("\nWrite and set these? (Y/n)", "y");
if (!/^y/i.test(go)) {
  console.log("Nothing was changed.");
  process.exit(0);
}
writeFileSync(PROFILE_PATH, written);
gh(["variable", "set", "DEXBOT_MARKETING_HOSTNAME", "-R", REPO, "--body", marketingHost]);
for (const secret of pending) {
  gh(["secret", "set", secret.name, "-R", REPO, "-e", ENV], secret.value);
  console.log(`  ${secret.name}: set`);
}
console.log(`
Done. Commit deployments/dexbot.json (it holds no secrets), and tell Claude.
Still open: the built-in model's name, the app id for the store apps, the
Android signing fingerprint and the Apple team id.`);
process.exit(0);
