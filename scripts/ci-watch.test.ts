import { describe, expect, test } from "bun:test";
import {
  formatReport,
  parseArguments,
  pullRequestReport,
  watch,
  type GitHubJson,
} from "./ci-watch.js";

/** Answers every `gh pr view` with one pull request. */
function fakeGitHub(pr: unknown): GitHubJson {
  return () => Promise.resolve(pr);
}

const merged = { state: "MERGED", url: "https://example.test/12" };
const open = (statusCheckRollup: unknown[]) => ({
  state: "OPEN",
  statusCheckRollup,
});

describe("pull request", () => {
  test("a merged pull request has landed", async () => {
    const report = await pullRequestReport(fakeGitHub(merged), 12);
    expect(report.status).toBe("passed");
    expect(report.summary).toContain("#12 merged");
  });

  test("a pull request closed without merging is a failure, not a wait", async () => {
    const report = await pullRequestReport(
      fakeGitHub({ state: "CLOSED", url: "u" }),
      12,
    );
    expect(report.status).toBe("failed");
    expect(report.summary).toContain("closed without merging");
  });

  test("names the checks that failed", async () => {
    const report = await pullRequestReport(
      fakeGitHub(
        open([
          { name: "Check", status: "COMPLETED", conclusion: "SUCCESS" },
          { name: "Flutter", status: "COMPLETED", conclusion: "FAILURE" },
        ]),
      ),
      12,
    );
    expect(report.status).toBe("failed");
    expect(report.summary).toBe("#12 has failing checks: Flutter");
  });

  test("a cancelled check never turns green, so it is a failure", async () => {
    const report = await pullRequestReport(
      fakeGitHub(
        open([{ name: "Check", status: "COMPLETED", conclusion: "CANCELLED" }]),
      ),
      12,
    );
    expect(report.status).toBe("failed");
  });

  test("waits while a check is still running, or before any has reported", async () => {
    const running = await pullRequestReport(
      fakeGitHub(
        open([{ name: "Flutter", status: "IN_PROGRESS", conclusion: "" }]),
      ),
      12,
    );
    expect(running.status).toBe("pending");
    expect(running.summary).toContain("Flutter");
    expect((await pullRequestReport(fakeGitHub(open([])), 12)).status).toBe(
      "pending",
    );
  });

  test("green checks on an open pull request is the session's terminal state", async () => {
    const report = await pullRequestReport(
      fakeGitHub(
        open([{ name: "Check", status: "COMPLETED", conclusion: "SUCCESS" }]),
      ),
      12,
    );
    expect(report.status).toBe("passed");
    expect(report.summary).toContain("the babysitter merges it");
  });

  test("a later run of a check replaces an earlier one on the same head", async () => {
    const report = await pullRequestReport(
      fakeGitHub(
        open([
          {
            name: "Set main-health",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            startedAt: "2026-09-28T02:22:05Z",
          },
          {
            name: "Set main-health",
            status: "COMPLETED",
            conclusion: "CANCELLED",
            startedAt: "2026-09-28T02:21:50Z",
          },
          { name: "Check", status: "COMPLETED", conclusion: "SUCCESS" },
        ]),
      ),
      12,
    );
    expect(report.status).toBe("passed");
  });

  test("a red main-health holds a green pull request without failing it", async () => {
    const report = await pullRequestReport(
      fakeGitHub(
        open([
          { name: "Check", status: "COMPLETED", conclusion: "SUCCESS" },
          { context: "main-health", state: "FAILURE" },
        ]),
      ),
      12,
    );
    expect(report.status).toBe("passed");
    expect(report.summary).toContain("main is red");
  });

  test("reads a legacy status context, which carries no status field", async () => {
    const report = await pullRequestReport(
      fakeGitHub(open([{ context: "legacy/build", state: "FAILURE" }])),
      12,
    );
    expect(report.status).toBe("failed");
    expect(report.summary).toContain("legacy/build");
  });
});

describe("watching", () => {
  test("--once reports what is true now rather than waiting", async () => {
    let sleeps = 0;
    const report = await watch(
      fakeGitHub(open([])),
      12,
      { once: true, intervalSeconds: 1, deadlineMinutes: 1 },
      () => {
        sleeps += 1;
        return Promise.resolve();
      },
    );
    expect(report.status).toBe("pending");
    expect(sleeps).toBe(0);
  });

  test("polls until the pull request settles", async () => {
    const states = [open([]), merged];
    let index = 0;
    const gh: GitHubJson = () => Promise.resolve(states[Math.min(index++, 1)]);
    const report = await watch(
      gh,
      12,
      { once: false, intervalSeconds: 1, deadlineMinutes: 5 },
      () => Promise.resolve(),
    );
    expect(report.status).toBe("passed");
  });

  test("gives up at the deadline and says so, still pending", async () => {
    let clock = 0;
    const report = await watch(
      fakeGitHub(open([])),
      12,
      { once: false, intervalSeconds: 1, deadlineMinutes: 1 },
      () => {
        clock += 60_000;
        return Promise.resolve();
      },
      () => clock,
    );
    expect(report.status).toBe("pending");
    expect(report.detail?.join(" ")).toContain("still pending after 1 minutes");
  });
});

describe("arguments", () => {
  test("rejects a leg it cannot watch: there is no release leg until DexBot deploys", () => {
    expect(() => parseArguments(["release", "v0.1.0"])).toThrow("usage:");
  });

  test("rejects a pull request with no number", () => {
    expect(() => parseArguments(["pr"])).toThrow("usage:");
    expect(() => parseArguments(["pr", "twelve"])).toThrow("usage:");
  });

  test("reads the polling flags", () => {
    const parsed = parseArguments([
      "pr",
      "12",
      "--interval-seconds",
      "5",
      "--deadline-minutes",
      "2",
    ]);
    expect(parsed.subject).toBe("12");
    expect(parsed.options).toEqual({
      once: false,
      intervalSeconds: 5,
      deadlineMinutes: 2,
    });
  });

  test("rejects a nonsense interval rather than polling forever", () => {
    expect(() =>
      parseArguments(["pr", "1", "--interval-seconds", "0"]),
    ).toThrow("positive number");
  });
});

describe("output", () => {
  test("prints the verdict first and its evidence beneath", () => {
    expect(
      formatReport({
        status: "failed",
        summary: "broke",
        detail: ["why", "url"],
      }),
    ).toBe("failed: broke\n  why\n  url");
  });
});
