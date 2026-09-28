/**
 * Writes the Routines the showcase stills show, as the server would send them.
 *
 * `test/showcase_shots_test.dart` answers `/api/bots/<id>/routines?as=document`
 * and `/routines/inbox` from `test/showcase/routines.json`. That JSON comes from
 * FrockBot's own projection (`routinesDocumentV1` in `@frockbot/app`), so the
 * panel draws exactly what a real Bot's Routines would draw. Every Routine is
 * illustrative. Re-run from the repository root after changing one:
 *
 *   bun app/tool/showcase_routines.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { routinesDocumentV1 } from "@frockbot/app/routines/routines-document";
import type {
  RoutineInboxEntryViewV1,
  RoutineViewV1,
} from "@frockbot/app/routines/shared";

const TIMEZONE = "Australia/Sydney";
const BOT_WRITER = (botId: string) =>
  ({ kind: "bot", botId, sessionId: "session-1", turnId: "turn-1" }) as const;

function routine(
  botId: string,
  routineId: string,
  name: string,
  prompt: string,
  schedule: string,
  lastRunAt: string,
  nextRunAt: string,
): RoutineViewV1 {
  return {
    schemaVersion: 1,
    routineId,
    name,
    prompt,
    schedule,
    timezone: TIMEZONE,
    enabled: true,
    createdBy: BOT_WRITER(botId),
    updatedBy: BOT_WRITER(botId),
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    lastRunAt,
    nextRunAt,
  };
}

/** An inbox entry is labelled with the name of the Routine that wrote it. */
const NAMES: Record<string, string> = {
  "weekly-report": "Weekly vault report",
  "apr-floor": "APR floor alert",
  "gas-check": "Gas-cost check",
  "range-watch": "Range watch",
  "morning-brief": "Morning range brief",
};

function entry(
  routineId: string,
  entryId: string,
  text: string,
  createdAt: string,
  acknowledged = true,
): RoutineInboxEntryViewV1 {
  return {
    schemaVersion: 1,
    entryId,
    runId: `run-${entryId}`,
    routineId,
    text,
    attribution: NAMES[routineId] ?? routineId,
    createdAt,
    acknowledged,
  };
}

const bots: Record<string, { routines: RoutineViewV1[]; inbox: RoutineInboxEntryViewV1[] }> = {
  dex: {
    routines: [
      routine("dex", "weekly-report", "Weekly vault report", "Summarise every vault's yield, APR and AiLM range moves for the week.", "0 8 * * 1", "2026-09-21T22:00:00.000Z", "2026-09-28T22:00:00.000Z"),
      routine("dex", "apr-floor", "APR floor alert", "After each harvest, message me if any vault's APR drops below 5%.", "@hourly", "2026-09-28T09:05:00.000Z", "2026-09-28T10:05:00.000Z"),
      routine("dex", "gas-check", "Gas-cost check", "Each evening, compare harvest gas share against yield and flag any vault where gas eats more than 10%.", "0 20 * * *", "2026-09-27T10:00:00.000Z", "2026-09-28T10:00:00.000Z"),
    ],
    inbox: [
      entry("apr-floor", "e1", "All vaults above 5% APR after the 19:00 harvest.", "2026-09-28T09:05:00.000Z"),
      entry("gas-check", "e2", "Gas share 1.9% of yield across your vaults. Nothing to flag.", "2026-09-27T10:00:00.000Z"),
      entry("weekly-report", "e3", "Weekly report sent: +$412.80 across three vaults.", "2026-09-21T22:00:00.000Z"),
    ],
  },
  ranges: {
    routines: [
      routine("ranges", "range-watch", "Range watch", "After every harvest, check the ETH/USDC AiLM position. Message me if it left its range or AiLM moved it.", "@hourly", "2026-09-27T23:02:00.000Z", "2026-09-28T00:02:00.000Z"),
      routine("ranges", "morning-brief", "Morning range brief", "Every morning, summarise overnight price moves against each AiLM range.", "30 7 * * *", "2026-09-27T21:30:00.000Z", "2026-09-28T21:30:00.000Z"),
    ],
    inbox: [
      entry("range-watch", "r1", "ETH/USDC back in range at 2,410–2,690 after AiLM recalibrated.", "2026-09-27T23:02:00.000Z", false),
      entry("range-watch", "r2", "ETH/USDC left its range at 06:48.", "2026-09-27T20:50:00.000Z", false),
      entry("morning-brief", "r3", "Quiet night: ETH moved 0.8%, every range held.", "2026-09-26T21:30:00.000Z"),
    ],
  },
};

const out: Record<string, unknown> = {};
for (const [botId, { routines, inbox }] of Object.entries(bots)) {
  const unacknowledged = inbox.filter((item) => !item.acknowledged).length;
  out[botId] = {
    document: routinesDocumentV1({ schemaVersion: 1, botId, routines, inbox, unacknowledged }),
    inbox: { schemaVersion: 1, botId, entries: inbox, unacknowledged },
  };
}
writeFileSync(
  join(import.meta.dir, "..", "test", "showcase", "routines.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(`Wrote the Routines of ${Object.keys(out).join(", ")}.`);
