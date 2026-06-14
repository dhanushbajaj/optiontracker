import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FinnhubProvider } from "../src/data/finnhubProvider";
import { MockProvider } from "../src/data/mockProvider";
import { runScan } from "../src/engines/report";
import { sendIdeaAlert } from "../api/_notify";

// ============================================================================
// Intraday high-conviction watcher — run every ~30 min during market hours by
// the GitHub Action. Scans the market and pushes an alert ONLY for a *new*
// idea whose conviction ≥ CONVICTION_THRESHOLD (default 8.0), deduped to one
// ping per ticker+direction per day via public/data/alerted.json (reset daily).
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");
const ALERTED = resolve(DATA_DIR, "alerted.json");

const THRESHOLD = parseFloat(process.env.CONVICTION_THRESHOLD || "8");

function etParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function isMarketHours(p: ReturnType<typeof etParts>): boolean {
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";
  if (weekend) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60; // 9:30–16:00 ET
}

interface AlertedState {
  date: string;
  keys: string[];
}

async function main() {
  const et = etParts();
  if (!isMarketHours(et) && process.env.FORCE !== "1") {
    console.log(`Market closed (${et.weekday} ${et.hour}:${String(et.minute).padStart(2, "0")} ET) — skipping.`);
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const hasKey = !!process.env.FINNHUB_API_KEY;
  const provider = hasKey ? new FinnhubProvider({ concurrency: 6 }) : new MockProvider();
  const dataMode = hasKey ? "live" : "mock";

  // Resolve session for the scan (engines need one); intraday leans "morning".
  const session = et.hour < 15 ? "morning" : "evening";
  const snapshot = await provider.getSnapshot(session);
  const { allIdeas } = runScan(snapshot, session);

  const qualifying = allIdeas.filter((i) => i.conviction >= THRESHOLD);
  console.log(`Scan done (${dataMode}). ${qualifying.length} idea(s) ≥ ${THRESHOLD}.`);

  // Load + roll over the daily dedup state.
  let state: AlertedState = { date: et.date, keys: [] };
  if (existsSync(ALERTED)) {
    try {
      const prev = JSON.parse(readFileSync(ALERTED, "utf8")) as AlertedState;
      if (prev.date === et.date) state = prev;
    } catch {
      /* reset */
    }
  }

  const fresh = qualifying.filter((i) => !state.keys.includes(`${i.ticker}-${i.direction}`));
  if (!fresh.length) {
    console.log("No new high-conviction setups to alert.");
    writeFileSync(ALERTED, JSON.stringify(state));
    return;
  }

  for (const idea of fresh) {
    const results = await sendIdeaAlert({
      ticker: idea.ticker,
      optionType: idea.optionType,
      direction: idea.direction,
      contract: `${idea.ticker} $${idea.contract.strike} ${idea.optionType.toUpperCase()} ${idea.contract.expiry}`,
      conviction: idea.conviction,
      riskLevel: idea.riskLevel,
      entry: `$${idea.entryLow}–$${idea.entryHigh}`,
      target: `$${idea.targetLow}+`,
      stop: `$${idea.stopPremium}`,
      invalidation: idea.invalidation,
      dataMode,
    });
    console.log(`⚡ Alerted ${idea.ticker} ${idea.optionType} (${idea.conviction}/10): ${results.join(" | ")}`);
    state.keys.push(`${idea.ticker}-${idea.direction}`);
  }

  writeFileSync(ALERTED, JSON.stringify(state));
  console.log(`✅ Sent ${fresh.length} intraday alert(s).`);
}

main().catch((e) => {
  console.error("Intraday watch failed:", e);
  process.exit(0); // never hard-fail the schedule
});
