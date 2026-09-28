#!/usr/bin/env bun
/**
 * Mints the secrets DexBot makes for itself — random keys no vendor issues —
 * straight into the GitHub `production` environment the deploy reads.
 *
 * The same set and shapes FrockBot's installer mints (`scripts/setup/plan.ts`
 * there), plus the Privy Package's session secret. Each value goes to
 * `gh secret set` on stdin and nowhere else: never printed, never written to
 * disk. GitHub secrets are write-only, so there is no copy to lose to a log,
 * and no copy to restore from either; a name already set is left alone,
 * because re-minting CREDENTIAL_KEYRING orphans every stored Connection
 * credential and the others sign durable tokens.
 *
 *   bun scripts/mint-secrets.ts [--repo gia-swarm/dexbot] [--env production]
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};
const REPO = flag("--repo", "gia-swarm/dexbot");
const ENV = flag("--env", "production");

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const random = (length = 32) => crypto.getRandomValues(new Uint8Array(length));
const hex = () => [...random()].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** One 32-byte key named by its month, as FrockBot's `credentialKeyringV1` makes it. */
function keyring(): string {
  const keyId = new Date().toISOString().slice(0, 7);
  return JSON.stringify({ schemaVersion: 1, currentKeyId: keyId, keys: { [keyId]: base64Url(random()) } });
}

const MINTED: Record<string, () => string> = {
  CREDENTIAL_KEYRING: keyring,
  COMPUTER_HOST_TOKEN: hex,
  APPLET_BUILD_TOKEN: hex,
  ROUTINE_HOOK_SECRET: hex,
  MACHINE_TOKEN_SECRET: hex,
  NATIVE_TOKEN_SECRET: hex,
  PRIVY_SESSION_SECRET: hex,
  DEBUG_TOKEN: hex,
};

function gh(cmd: string[], stdin?: string) {
  const result = Bun.spawnSync({
    cmd: ["gh", ...cmd],
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${cmd.slice(0, 3).join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

// The environment the deploy job names; creating it again changes nothing.
gh(["api", "-X", "PUT", `repos/${REPO}/environments/${ENV}`]);
const existing = new Set(
  (JSON.parse(gh(["secret", "list", "-R", REPO, "-e", ENV, "--json", "name"])) as { name: string }[]).map(
    (secret) => secret.name,
  ),
);
for (const [name, mint] of Object.entries(MINTED)) {
  if (existing.has(name)) {
    console.log(`  ${name}: already set, left alone`);
    continue;
  }
  gh(["secret", "set", name, "-R", REPO, "-e", ENV], mint());
  console.log(`  ${name}: minted`);
}
