---
name: babysit
description: Own DexBot's delivery pipeline once a pull request is open — keep main green and merge ready pull requests. Use when the user says "babysit", "babysit this", "babysit the PRs", "manage the PRs", "merge what's ready", "is main green", "why is main red", asks whether a change has landed, or runs /babysit or /loop /babysit.
---

# Babysit

An authoring session's job ends when its pull request is open and its own
checks are green. From there a babysitter owns everything: the merge and
`main`. Babysitters are the only thing that merges, and any number can run at
once — one per authoring session, plus one watching everything. One run is a
**tick**; a tick is safe to repeat, so `/loop /babysit` runs it on a
self-paced schedule, overnight included.

This is FrockBot's babysitter, ported. Two things differ, and both matter:

- **Nothing enforces the gate.** `gia-swarm/dexbot` is a private repository
  on GitHub's free plan, which has no rulesets and no required status checks.
  GitHub will merge a pull request with failing checks, onto a red `main`,
  for anyone who asks. The `main-health` status still appears on every pull
  request, but it is only a signal. **You are the gate:** merge only what the
  snapshot says `merge`, and never merge a `held` pull request because GitHub
  would let you.
- **Nothing deploys yet.** A merge is where a change ends; there is no
  release tag and no production to watch. When DexBot starts deploying, bring
  back FrockBot's Production section and the snapshot's `production` seam
  (the header of `scripts/babysit.ts` says where).

## Starting

"Babysit this" means keep babysitting, not look once. Unless this turn is
already a `/loop` firing, invoke the `loop` skill yourself — nobody should
have to type the slash commands — and it runs the first tick and paces the
rest. Run a single tick without the loop only for a question that wants one
answer: "is main green?", "has #12 landed?".

**Scope.** "Babysit this", in a session that opened pull requests, watches
those: loop `/babysit #12` (every number the session opened), and each tick
snapshots with `--pr 12`. A scoped babysitter merges and repairs only its
own pull requests and stops its loop once every one has merged or closed —
the snapshot's `landed` lines say which. "Babysit", "babysit the PRs" or
"babysit everything" watches every open pull request and never stops by
itself; stop it when Tim says so.

**Together.** Two babysitters merging is harmless: `--match-head-commit`
refuses a merge of a head that moved, and GitHub refuses to merge a pull
request twice, so a refused merge means take a new snapshot. What must not
happen twice is a repair, so a red `main` is claimed (below), and an idle
pull request is taken over only after saying so on it and only with
`--force-with-lease`.

## A tick

1. **Snapshot.** `bun scripts/babysit.ts` (add `--json` to read fields).
   It reads GitHub and changes nothing. `gh` fails TLS inside the Bash
   sandbox, so run it, and every `gh` call below, with the sandbox off.
2. **`main`**, then **pull requests**, in that order — each section below.
   `main` goes first because it decides whether anything may merge.
3. **Report** (below), then pace the next tick.

Never act on a snapshot older than the tick: after a merge, a rerun or a
push, take a new one before deciding anything else.

## `main`

`main` is the `Main` workflow (`.github/workflows/main.yml`): the PR tier
again on the merge commit (`Fast tier / Check`, `Fast tier / Flutter`) and
the release web build (`Flutter web build`).

**Green:** nothing to do. If a run is in flight over merges you made, note it.

The snapshot counts a run as red unless it passed: a job that hits its
timeout shows as `cancelled`, and a failed run you reran stays red
(`rerunning`) until its new attempt passes. Only a run the concurrency group
displaced before it started is passed over.

**Red — stop the line.** Only a pull request labelled `fix-main`, or a
revert, may merge until `main` is green; the snapshot marks every other
green pull request `held`. GitHub will not stop anyone else, so if a person
or session merges onto a red `main` anyway, it joins the suspects; say so
in the report.

**Claim the repair first.** The snapshot's `repair claimed` line is an open
issue labelled `main-red`. If there is one, another babysitter owns the
repair: hold, and do nothing below unless the claim has been silent for 30
minutes, in which case comment that you are taking it over. If there is
none, open one — `gh issue create --label main-red --title "main red since
<time>: <failed jobs>"`, body naming the run — then check again that yours
is the oldest open `main-red` issue; if another was opened first, close
yours and hold. The owner comments what it finds and does, and closes the
issue once `main` is green. Then, in order:

1. **Read the failure.** `gh run view <id> --log-failed > <scratch>/main-<id>.log`
   and grep it rather than reading whole logs into context: bun's `(fail)`
   lines and `error:`, `error TS` from tsc, `error •`/`warning •`/`info •`
   from `flutter analyze`, `[E]` and `Some tests failed` from `flutter test`,
   and the deploy dry run's thrown `exited` message.
2. **Flake or regression?** Most red is real. It is a flake when the
   failure is infrastructure (a registry or `pub.dev` fetch that timed out
   or returned 5xx, a runner that lost its connection, OOM, a job cancelled
   at its limit), or when the test has an open issue labelled `flaky`, or
   when the same test passed on a later or earlier run over the same code.
   A failure in an area a suspect changed, or one that fails the same way
   twice, is a regression.
3. **Flake:** `gh run rerun <id> --failed`, once per run — never a second
   time. When the rerun passes, record the flake: find the issue
   (`gh issue list --label flaky --search "<test name>"`) and add the run
   link, or open one titled with the test's file and name, labelled `flaky`.
   That list is what "known flake" means next time.
4. **Regression: attribute it.** The snapshot's suspects are every landing
   between the last green commit and the failing head. Match the failing
   test's area to their diffs (`gh pr diff <n> --name-only`). Say which one
   and why; if you can't narrow it, say that.
5. **Is someone already on it?** Check open pull requests (label
   `fix-main`, titles naming the test or area) and anything merged since
   the failing head. Two sessions repairing the same break is how FrockBot
   once broke `main` a third time. If a fix is open, get it merged; don't
   write a second.
6. **Repair.** A small, clear fix: a worktree off `origin/main`, the fix,
   a pull request labelled `fix-main`, merged as soon as its checks pass.
   Otherwise, once `main` has been red for 30 minutes with the culprit
   identified and no fix under way: revert it (below). A revert is not a
   judgement on the work; it reopens it. If you can't identify the culprit,
   say so and keep narrowing; never revert a guess.

**Reverting.** `git revert --no-edit <sha>` for a squash, or
`git revert --no-edit -m 1 <sha>` for a merge commit, on a branch off
`origin/main`; open it titled `Revert "<original title>"` (the snapshot and
`main-health` treat that title as a repair); link the failing run in the
body; comment on the original pull request with the failure and what to
reland.

## Pull requests

`Check` (`.github/workflows/check.yml`) reports two checks on every pull
request, `Check` and `Flutter`; the snapshot waits for both by name
(`REQUIRED_CHECKS`). It gives each open pull request an action:

- **merge** — green, mergeable, and `main` is green (or it repairs `main`).
  `gh pr merge <n> --squash --delete-branch --match-head-commit <headSha>`.
  `--match-head-commit` refuses if someone pushed after the checks you saw.
  Merge every ready one; the snapshot's suspects list keeps attribution
  honest if the combination breaks `main`. A merge GitHub refuses means the
  snapshot is stale: take a new one rather than retrying.
- **fix** — a check failed. A flake (same tests as above): rerun the failed
  jobs once (`gh run rerun <run> --failed`; `gh pr checks <n>` gives the
  run). A real failure: leave it while the author is active — idle under
  30 minutes means its session is probably on it. Idle longer: check out
  the branch in a worktree (`gh pr checkout <n>`), fix it, push, and say
  so on the pull request.
- **rebase** — conflicts with `main`. Merge conflicts are the
  babysitter's, not the author's, and are resolved only when it is that
  pull request's turn: green apart from the conflict, `main` green, and
  nothing ready ahead of it. An earlier rebase is often wasted, because the
  merges before it bring the conflict back. If an authoring session is
  rebasing its own pull request for a conflict, message it to stop and hand
  off at green. No idle wait. In a worktree:
  `git fetch origin main && git rebase origin/main`, resolve,
  `bun install --frozen-lockfile`, `bun run typecheck` and `bun run test`
  (and `flutter analyze --no-pub` and `flutter test` in `app/` when the
  conflict touched it), `git push --force-with-lease`, and say what you
  resolved on the pull request. A conflict in a lockfile (`bun.lock`,
  `app/pubspec.lock`) is resolved by taking `main`'s side and rerunning
  `bun install` or `flutter pub get`, never by hand.
- **wait** — checks running, or GitHub still deciding mergeability (it
  computes that when first asked, so the next snapshot usually has it).
- **held** — green, but `main` is red. Nothing; it merges when `main` is
  green again. A failing `main-health` is this, never a `fix`. GitHub would
  merge it; you don't.
- **skip** — draft, labelled `hold`, not based on `main`, changes
  requested, or from a fork. A fork's pull request is an outside
  contribution: never merge, push to or rerun it; list it once under
  "needs Tim".

Dependabot pull requests, if they arrive, go through the same actions; a
bump that breaks `Check` in a way that isn't a one-line fix goes to Tim. So
does a bump of the `@frockbot/*` pins or the client's FrockBot tag, which
move together (`app/README.md` → The pin).

The labels are `hold` (leave it alone), `fix-main` (repairs a red `main`),
`flaky` (issues) and `main-red` (the repair claim). If one is missing,
create it with `gh label create`.

## Sessions

`DONE ` at the front of a session's title says its goal is complete: every
pull request it opened has merged. `DONE-TODO ` says the same, and that the
session also surfaced things still to do, perhaps as separate work: a
follow-up it named, a question waiting on Tim, a branch still to open, a
verification it is waiting on. Tim reads the prefix to decide what to close.

Once a session's pull requests have all merged, read the end of its
conversation (`list_events` for a local session, `RemoteTrigger
get_run_log` for a cloud one). Give it `DONE ` when nothing is left, or
`DONE-TODO ` and name the items in the report under "needs Tim". When they
clear, change `DONE-TODO ` to `DONE `.

For a `DONE-TODO ` session, also message it (`SendMessage`) to end with one
short message listing what is still to do and whose call each item is, and
to start none of it. That last message is what Tim reads when he opens the
session, instead of scrolling back through the chat.

Rename each session once per state, not every tick:

- A local desktop session: `set_session_title` (the `ccd_session_mgmt`
  tools) with the sessionId from `list_sessions`.
- A cloud session is not visible to those tools. `SendMessage` it asking it
  to rename itself with the prefix and, for `DONE-TODO `, to list its
  to-dos as above; nothing else. It then drops out
  of `ListAgents`, and its run log may return 404; neither means it was
  deleted.

Only DexBot sessions, and never a title Tim prefixed himself (`zzz`).

## Boundaries

Never push to `main`, arm auto-merge, push a tag, deploy, change repository
settings, close a pull request, merge anything the snapshot did not call
`merge`, or force-push without `--force-with-lease`. Code you write here — a
fix, a rebase, a revert — goes through a pull request like anyone's.

## Report

Every tick ends with a few lines: state first, then what you did, then what
needs Tim. Leave out what hasn't changed since the last tick.

```
main green · run 18123… on 1adeced
merged #14 Add a thing · reran flaky Flutter (run 18130…) · rebased #12
waiting #15 (Flutter) · held none
needs Tim: #13 bumps @frockbot/* to 0.7.300, dry run fails in the brand decoder
```

Raise a "needs Tim" item once, and again only when it changes. Stale work —
a draft or `hold` older than a week, a `fix` idle for two days — is a line
once a day, not every tick.

## Pacing under `/loop`

Wake when there is something to see, not on a timer:

- `main` red, or a run in flight over a merge you made: about 5 minutes
  (a `Main` run takes ~5).
- Pull requests waiting on checks: about 4 minutes (`Flutter`, the slower
  of the two, takes ~3).
- Nothing moving: 20–30 minutes.
