import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FinnhubProvider } from "../src/data/finnhubProvider";
import { MockProvider } from "../src/data/mockProvider";

// ============================================================================
// Outcome tracker — backfills performance on past recommendations in
// history.json. For each open ledger entry it checks current spot vs the spot
// at recommendation and marks the directional result at the 1d / 3d / 1w
// horizons once enough time has passed. Run daily by the cron workflow.
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const HIST = resolve(__dirname, "../public/data/history.json");

interface Entry {
  ticker: string;
  direction: "bullish" | "bearish" | "neutral";
  spotAtRec: number;
  generatedAt: string;
  outcome: { d1: number | null; d3: number | null; w1: number | null; expiry: number | null };
}

async function currentPrices(_tickers: string[]): Promise<Record<string, number>> {
  const provider = process.env.FINNHUB_API_KEY ? new FinnhubProvider() : new MockProvider();
  const out: Record<string, number> = {};
  const snap = await provider.getSnapshot("evening");
  for (const q of snap.quotes) out[q.ticker] = q.price;
  return out;
}

function dirPnL(direction: string, from: number, to: number): number {
  const move = ((to - from) / from) * 100;
  // Estimate option P/L as ~5x the underlying move in the trade's direction,
  // then clamp to option reality: a long option can lose at most 100% of the
  // premium, and we cap the upside estimate at +300%.
  const signed = direction === "bearish" ? -move : move;
  return Math.round(Math.max(-100, Math.min(300, signed * 5)));
}

async function main() {
  if (!existsSync(HIST)) {
    console.log("No history.json yet — nothing to track.");
    return;
  }
  const history = JSON.parse(readFileSync(HIST, "utf8")) as Entry[];
  const open = history.filter(
    (e) => e.outcome && (e.outcome.d1 === null || e.outcome.d3 === null || e.outcome.w1 === null)
  );
  if (!open.length) {
    console.log("All recommendations already tracked.");
    return;
  }

  const prices = await currentPrices([...new Set(open.map((e) => e.ticker))]);
  const now = Date.now();
  let updated = 0;

  for (const e of history) {
    if (!e.outcome) continue;
    const ageDays = (now - new Date(e.generatedAt).getTime()) / 86400000;
    const cur = prices[e.ticker];
    if (cur == null) continue;
    const pnl = dirPnL(e.direction, e.spotAtRec, cur);
    if (ageDays >= 1 && e.outcome.d1 === null) { e.outcome.d1 = pnl; updated++; }
    if (ageDays >= 3 && e.outcome.d3 === null) { e.outcome.d3 = pnl; updated++; }
    if (ageDays >= 7 && e.outcome.w1 === null) { e.outcome.w1 = pnl; updated++; }
  }

  writeFileSync(HIST, JSON.stringify(history.slice(0, 500)));
  console.log(`✔ Updated ${updated} outcome field(s) across ${open.length} open recommendation(s).`);
}

main().catch((e) => {
  console.error("Outcome tracking failed:", e);
  process.exit(0);
});
