/**
 * Watches a pull request to its terminal state, so that opening one is not
 * mistaken for the work having landed. A red check on an open pull request is
 * quiet; this reports it as a plain exit code, so a session, a hook or a
 * person reads the same verdict:
 *
 *   0  settled, and settled well: the pull request is green or merged
 *   1  failed, and the summary says what and where
 *   2  still pending — not an error, just not finished
 *
 *   bun scripts/ci-watch.ts pr 12
 *   bun scripts/ci-watch.ts pr 12 --once
 *
 * The default is to poll to a deadline. `--once` reports the current state and
 * exits, which is what a caller that owns its own scheduling wants: a session
 * pacing itself between turns, or a hook that must not block.
 *
 * DexBot does not deploy yet, so merging is the end of the line and there is
 * only the pull request leg. When a tag starts shipping production, FrockBot's
 * `release <tag>` leg (its `scripts/ci-watch.ts`, `releaseReport`) is the one
 * to bring over: it reads the release run and fails a release whose deploy
 * jobs did not succeed.
 */

export type WatchStatus = "passed" | "failed" | "pending";

export interface WatchReport {
  status: WatchStatus;
  summary: string;
  /** Lines of supporting evidence: which check, which URL. */
  detail?: string[];
}

/** Runs `gh` with `--json`-shaped arguments and parses what it prints. */
export type GitHubJson = (args: readonly string[]) => Promise<unknown>;

/**
 * A check that reached one of these has nothing left to do and did not pass.
 * `CANCELLED` counts: a cancelled check never becomes a green one, so a pull
 * request waiting on it waits forever.
 */
const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface Check {
  name: string;
  /** Absent while the check is still running. */
  conclusion: string;
  complete: boolean;
}

/**
 * A status rollup mixes two shapes: `CheckRun` has a name and a conclusion,
 * and the older `StatusContext` has a context and a state. `main-health` is
 * the second kind. Read both, so a check reported by either is not silently
 * treated as passing.
 */
export function checksOf(rollup: unknown): Check[] {
  // Two runs of one workflow on the same head both report — `main-health`
  // runs on every pull request event — so a later run of a check replaces
  // an earlier one rather than standing beside it as a second verdict.
  const latest = new Map<string, { check: Check; startedAt: string }>();
  for (const entry of list(rollup)) {
    const value = record(entry, "status check");
    const name = text(value.name) || text(value.context) || "unnamed check";
    const conclusion = (
      text(value.conclusion) || text(value.state)
    ).toUpperCase();
    const status = text(value.status).toUpperCase();
    // A StatusContext has no `status` field; its state alone says whether it
    // settled, and `PENDING` is the one state that means it has not.
    const complete = status
      ? status === "COMPLETED"
      : conclusion !== "" &&
        conclusion !== "PENDING" &&
        conclusion !== "EXPECTED";
    const startedAt = text(value.startedAt);
    const seen = latest.get(name);
    if (!seen || startedAt >= seen.startedAt)
      latest.set(name, { check: { name, conclusion, complete }, startedAt });
  }
  return [...latest.values()].map((entry) => entry.check);
}

export async function pullRequestReport(
  gh: GitHubJson,
  pullRequest: number,
): Promise<WatchReport> {
  const value = record(
    await gh([
      "pr",
      "view",
      String(pullRequest),
      "--json",
      "state,mergedAt,statusCheckRollup,url",
    ]),
    "pull request",
  );
  const url = text(value.url) || `pull request #${pullRequest}`;
  const state = text(value.state).toUpperCase();

  if (state === "MERGED") {
    return {
      status: "passed",
      summary: `#${pullRequest} merged`,
      detail: [url],
    };
  }
  if (state === "CLOSED") {
    return {
      status: "failed",
      summary: `#${pullRequest} was closed without merging`,
      detail: [url],
    };
  }

  // `main-health` reports `main`, not this pull request (see
  // `scripts/main-health.ts`), so it is read apart from the rest.
  const all = checksOf(value.statusCheckRollup);
  const health = all.find((check) => check.name === "main-health");
  const checks = all.filter((check) => check !== health);
  const failed = checks.filter(
    (check) => check.complete && FAILING_CONCLUSIONS.has(check.conclusion),
  );
  if (failed.length > 0) {
    return {
      status: "failed",
      summary: `#${pullRequest} has failing checks: ${failed
        .map((check) => check.name)
        .join(", ")}`,
      detail: [
        ...failed.map((check) => `${check.name}: ${check.conclusion}`),
        url,
      ],
    };
  }

  const running = checks.filter((check) => !check.complete);
  if (running.length > 0 || checks.length === 0) {
    return {
      status: "pending",
      summary:
        checks.length === 0
          ? `#${pullRequest} has no checks reported yet`
          : `#${pullRequest} is waiting on ${running
              .map((check) => check.name)
              .join(", ")}`,
      detail: [url],
    };
  }

  // Every check passed and the pull request is still open. Merging belongs
  // to the babysitter (`.claude/skills/babysit/SKILL.md`) — there is no
  // auto-merge — so for the session that opened it this is the terminal
  // state: its work is done and green, even while a red `main` holds it.
  const held = health?.complete && FAILING_CONCLUSIONS.has(health.conclusion);
  return {
    status: "passed",
    summary: held
      ? `#${pullRequest} is green; main is red, so it merges once main is green again`
      : `#${pullRequest} is green; the babysitter merges it`,
    detail: [url],
  };
}

const EXIT_CODES: Record<WatchStatus, number> = {
  passed: 0,
  failed: 1,
  pending: 2,
};

export function formatReport(report: WatchReport): string {
  const lines = [`${report.status}: ${report.summary}`];
  for (const line of report.detail ?? []) lines.push(`  ${line}`);
  return lines.join("\n");
}

export interface WatchOptions {
  once: boolean;
  intervalSeconds: number;
  deadlineMinutes: number;
}

export function parseArguments(argv: readonly string[]): {
  leg: "pr";
  subject: string;
  options: WatchOptions;
} {
  const [leg, subject, ...rest] = argv;
  if (leg !== "pr" || !subject || !/^\d+$/.test(subject)) {
    throw new Error(
      "usage: bun scripts/ci-watch.ts pr <number> [--once] [--interval-seconds n] [--deadline-minutes n]",
    );
  }
  const numeric = (flag: string, fallback: number): number => {
    const index = rest.indexOf(flag);
    if (index === -1) return fallback;
    const value = Number(rest[index + 1]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${flag} needs a positive number`);
    }
    return value;
  };
  return {
    leg,
    subject,
    options: {
      once: rest.includes("--once"),
      // `Check` is a few minutes, so a minute between polls is frequent
      // enough to feel immediate and rare enough to be free.
      intervalSeconds: numeric("--interval-seconds", 60),
      deadlineMinutes: numeric("--deadline-minutes", 30),
    },
  };
}

export async function watch(
  gh: GitHubJson,
  pullRequest: number,
  options: WatchOptions,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): Promise<WatchReport> {
  const deadline = now() + options.deadlineMinutes * 60_000;
  for (;;) {
    const report = await pullRequestReport(gh, pullRequest);
    if (report.status !== "pending" || options.once) return report;
    if (now() >= deadline) {
      return {
        ...report,
        detail: [
          ...(report.detail ?? []),
          `still pending after ${options.deadlineMinutes} minutes`,
        ],
      };
    }
    await sleep(options.intervalSeconds * 1_000);
  }
}

async function ghJson(args: readonly string[]): Promise<unknown> {
  const result = Bun.spawnSync(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString().trim();
  if (result.exitCode !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return stdout ? JSON.parse(stdout) : null;
}

if (import.meta.main) {
  const { subject, options } = parseArguments(process.argv.slice(2));
  const report = await watch(ghJson, Number(subject), options);
  console.log(formatReport(report));
  process.exit(EXIT_CODES[report.status]);
}
