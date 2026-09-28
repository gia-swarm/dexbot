# DexBot

DexBot is a white-label of FrockBot: the server builds from FrockBot's published `@frockbot/*` packages with DexBot's profile, brand and Privy auth Package, and `app/` runs FrockBot's Flutter client with DexBot's brand ([FrockBot ADR 0038](https://github.com/timoconnellaus/frockbot/blob/main/docs/adr/0038-white-label-deployments.md)).

## Working here

- Before the PR, run the tier `Check` runs: `bun run typecheck`, `bun run test` and `bun run deploy:dry-run`, plus `flutter analyze --no-pub` and `flutter test --no-pub --dart-define=FROCKBOT_ORIGIN=https://tests.invalid` in `app/` when the client changed.
- A branch need not be rebased when `main` moves: `Main` checks the merge commit itself once it lands. Do not rebase to resolve a conflict either: merge conflicts are the babysitter's, resolved when the pull request is next to merge.
- Hand off at the PR. Open it non-draft; your session is done once its own checks (`Check`, `Flutter`) are green, and `bun scripts/ci-watch.ts pr <n>` watches to that point. Do not merge by hand. Babysitters ([`.claude/skills/babysit/SKILL.md`](.claude/skills/babysit/SKILL.md)) are the only thing that merges, squash-only and only while `main` is green, and they own a red `main`: attributing it, fixing it or reverting the culprit, one claimed repair at a time. Asked to "babysit this", a session becomes the babysitter for its own pull requests until they merge; any number can run at once.
- GitHub enforces none of this. The repository is on the free plan, with no rulesets or required checks, so GitHub will merge a red pull request onto a red `main` for anyone. The rules hold only because everyone here follows them. A failing `main-health` status means `main` is red, not that your PR is.
- Label a PR `hold` if it must not merge yet and `fix-main` if it repairs a red `main`. Never arm `gh pr merge --auto`, never push to `main`, and never force-push without `--force-with-lease`.
- Nothing deploys yet: merging lands a change on `main` and stops there. Never deploy or push a tag unless asked.
- The `@frockbot/*` npm pins and the client's FrockBot tag in `app/pubspec.yaml` move together ([`app/README.md`](app/README.md) → The pin).
