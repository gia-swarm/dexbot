#!/usr/bin/env bun
/**
 * Everything a DexBot deploy does short of reaching Cloudflare, the way
 * FrockBot's white-label fixture proves a consumer builds (FrockBot ADR 0038
 * §5):
 *
 *   1. the Privy sign-in script is bundled;
 *   2. `frockbot-deployment-config dexbot` writes the wrangler config;
 *   3. the secrets check demands the Privy Package's secrets and no built-in
 *      Package's;
 *   4. `build-artifact.ts --brand` bundles the application artifact with
 *      DexBot's brand;
 *   5. `wrangler deploy --dry-run` bundles the Worker, and its inputs are
 *      checked: DexBot's chooser and brand are in, better-auth and FrockBot's
 *      brand are not.
 *
 * The web client is `dist/web` when `build-flutter-web.ts` has staged it, and a
 * stub otherwise, since Flutter is the app job's and a dry run doesn't upload.
 *
 *   bun scripts/deploy-dry-run.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PROFILE = "dexbot";
const BIN = join(ROOT, "node_modules", ".bin");
const CLOUDFLARE = join(ROOT, "node_modules", "@frockbot", "cloudflare");
const DIST = join(ROOT, "dist");

function run(cmd: string[], env: Record<string, string | undefined> = process.env): string {
  const result = Bun.spawnSync({ cmd, cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0) {
    throw new Error(`\`${cmd.join(" ")}\` exited ${result.exitCode}:\n${output}`);
  }
  return output;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Deploy dry run: ${message}`);
}

const scratch = mkdtempSync(join(tmpdir(), "dexbot-dry-run-"));
try {
  // 1. The sign-in script the chooser imports.
  run(["bun", "run", "--filter", "@dexbot/auth-privy", "build"]);

  // 2. The wrangler config, from the profile.
  console.log(run([join(BIN, "frockbot-deployment-config"), PROFILE]).trimEnd());
  const config = join(ROOT, ".deployment", PROFILE, "app", "wrangler.jsonc");
  const written = readFileSync(config, "utf8");
  check(written.includes('"PRIVY_APP_ID"'), "the Privy app id is not a var");
  for (const secret of ["PRIVY_SESSION_SECRET", "PRIVY_VERIFICATION_KEY", "NATIVE_TOKEN_SECRET"]) {
    check(!written.includes(secret), `${secret} leaked into the generated config`);
  }
  check(!written.includes("d1_databases"), "an AUTH_DB nobody asked for");

  // 3. The production-secrets check.
  const secretsFile = join(scratch, "secrets.json");
  run(
    [join(BIN, "frockbot-deployment-config"), "secrets", PROFILE, "write-secrets-file", secretsFile],
    {
      ...process.env,
      PRIVY_SESSION_SECRET: "dry-run",
      PRIVY_VERIFICATION_KEY: "dry-run",
      NATIVE_TOKEN_SECRET: "dry-run",
      BETTER_AUTH_SECRET: "not-this-deployment's",
    },
  );
  const carried = Object.keys(JSON.parse(readFileSync(secretsFile, "utf8")));
  check(carried.includes("PRIVY_SESSION_SECRET"), "the secrets file lacks the Privy session secret");
  check(!carried.includes("BETTER_AUTH_SECRET"), "the secrets file carries better-auth's secret");
  const missing = Bun.spawnSync({
    cmd: [join(BIN, "frockbot-deployment-config"), "secrets", PROFILE, "check"],
    cwd: ROOT,
    env: { PATH: process.env.PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  check(
    missing.exitCode === 1 && missing.stderr.toString().includes("PRIVY_SESSION_SECRET"),
    "the secrets check does not demand the Privy session secret",
  );
  console.log(`The secrets check covers ${carried.length} secrets, the Privy Package's included.`);

  // 4. The application artifact, with DexBot's brand.
  const staged = existsSync(join(DIST, "flutter-web.json"));
  if (!staged) {
    mkdirSync(join(DIST, "web"), { recursive: true });
    writeFileSync(
      join(DIST, "flutter-web.json"),
      `${JSON.stringify({ schemaVersion: 1, buildHash: "dry-run", files: [] })}\n`,
    );
    writeFileSync(join(DIST, "web", "index.html"), "DexBot dry run\n");
  }
  run([
    "bun",
    join(CLOUDFLARE, "build-artifact.ts"),
    "--brand",
    join(ROOT, "packages", "brand", "src", "brand.ts"),
    "--dist",
    DIST,
  ]);
  const artifact = readFileSync(join(DIST, "artifacts", "foundation-v1.mjs"), "utf8");
  check(
    artifact.includes("DexBot") && !artifact.includes('productName:"FrockBot"'),
    "the application artifact does not carry DexBot's brand",
  );
  console.log(`Built the application artifact with DexBot's brand${staged ? "" : " (stub web client)"}.`);

  // 5. The Worker, as `wrangler deploy` would upload it.
  const metafile = join(scratch, "worker.meta.json");
  run(
    [join(BIN, "wrangler"), "deploy", "--dry-run", "-c", config, "--outdir", join(scratch, "worker"), "--metafile", metafile],
    { ...process.env, WRANGLER_SEND_METRICS: "false" },
  );
  const inputs = Object.keys((JSON.parse(readFileSync(metafile, "utf8")) as { inputs: object }).inputs);
  const reaches = (fragment: string) => inputs.some((input) => input.replaceAll("\\", "/").includes(fragment));
  check(reaches("auth-privy/src/auth-package.privy.ts"), "the Worker does not bundle the Privy chooser");
  check(reaches("brand/src/brand.ts"), "the Worker does not bundle DexBot's brand");
  check(reaches("@frockbot/cloudflare/src/index.ts"), "the Worker was not built from the published package");
  check(
    !reaches("node_modules/better-auth/") && !reaches("@frockbot/cloudflare/src/auth-package"),
    "the Worker bundles an auth Package DexBot did not choose",
  );
  check(!reaches("@frockbot/cloudflare/src/brand.ts"), "the Worker bundles FrockBot's brand");
  check(readdirSync(join(scratch, "worker")).some((file) => file.endsWith(".js")), "wrangler wrote no bundle");
  console.log(`wrangler deploy --dry-run bundled DexBot's Worker from ${inputs.length} inputs.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
