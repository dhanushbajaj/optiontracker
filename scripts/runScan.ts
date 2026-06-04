import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerProvider, getProvider } from "../src/data/provider";
import { MockProvider } from "../src/data/mockProvider";
import { FinnhubProvider } from "../src/data/finnhubProvider";
import { runScan } from "../src/engines/report";
import type { ReportType } from "../src/types";

// ============================================================================
// Scan runner — executed by the GitHub Actions cron (and locally). Fetches a
// live snapshot, runs the full analysis pipeline, and persists results into
// public/data/ which the static frontend reads. This file-based store IS the
// database in the serverless model: latest-*.json are the current reports and
// history.json is the append-only recommendation log (with outcome slots that
// a follow-up job backfills after 1d / 3d / 1w / expiry).
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");

function etHour(): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  return parseInt(s, 10) % 24;
}

function resolveSession(): ReportType {
  const arg = process.argv.find((a) => a.startsWith("--session="))?.split("=")[1];
  if (arg === "morning" || arg === "evening") return arg;
  // auto: anything before 15:00 ET counts as the morning prep, else evening.
  return etHour() < 15 ? "morning" : "evening";
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const hasKey = !!process.env.FINNHUB_API_KEY;
  const dataMode = hasKey ? "live" : "mock";
  registerProvider(hasKey ? new FinnhubProvider() : new MockProvider());

  const session = resolveSession();
  console.log(`▶ Running ${session} scan with ${getProvider().id} provider…`);

  const snapshot = await getProvider().getSnapshot(session);
  const result = runScan(snapshot, session);

  const meta = {
    generatedAt: new Date().toISOString(),
    session,
    dataMode,
    provider: getProvider().id,
    note:
      dataMode === "live"
        ? "Quotes, news, earnings & analyst trends are live (Finnhub). Technicals are derived from live price/returns; options chains, IV and flow are modeled (no free options data)."
        : "Sample data — set FINNHUB_API_KEY for live quotes.",
  };

  const bundle = { meta, scan: result };
  const latestPath = resolve(DATA_DIR, `latest-${session}.json`);
  writeFileSync(latestPath, JSON.stringify(bundle));
  console.log(`✔ Wrote ${latestPath}`);

  // ---- status pointer ----------------------------------------------------
  const statusPath = resolve(DATA_DIR, "status.json");
  const status = readJson<Record<string, unknown>>(statusPath, {});
  status[`last_${session}`] = meta.generatedAt;
  status.dataMode = dataMode;
  status.provider = getProvider().id;
  writeFileSync(statusPath, JSON.stringify(status));

  // ---- append top idea to history (the recommendation ledger) -----------
  const top = result.report.topIdea;
  if (top) {
    const histPath = resolve(DATA_DIR, "history.json");
    const history = readJson<unknown[]>(histPath, []);
    history.unshift({
      id: `${top.id}-${meta.generatedAt}`,
      generatedAt: meta.generatedAt,
      session,
      dataMode,
      ticker: top.ticker,
      direction: top.direction,
      optionType: top.optionType,
      strike: top.contract.strike,
      expiry: top.contract.expiry,
      premiumAtRec: top.contract.last,
      spotAtRec: top.spotAtRec,
      conviction: top.conviction,
      riskLevel: top.riskLevel,
      target: top.targetLow,
      stop: top.stopPremium,
      thesis: top.thesis,
      invalidation: top.invalidation,
      // outcome slots (backfilled by trackOutcomes job)
      outcome: { d1: null, d3: null, w1: null, expiry: null },
    });
    writeFileSync(histPath, JSON.stringify(history.slice(0, 500)));
    console.log(`✔ Logged ${top.ticker} ${top.optionType} to history (conviction ${top.conviction}).`);
  }

  // ---- summary for the notifier -----------------------------------------
  const summaryPath = resolve(DATA_DIR, "last-summary.json");
  writeFileSync(
    summaryPath,
    JSON.stringify({
      session,
      dataMode,
      generatedAt: meta.generatedAt,
      headline: result.report.headline,
      sentiment: result.report.sentiment.label,
      sentimentScore: result.report.sentiment.score,
      topIdea: top
        ? {
            ticker: top.ticker,
            optionType: top.optionType,
            direction: top.direction,
            contract: `${top.ticker} $${top.contract.strike} ${top.optionType.toUpperCase()} ${top.contract.expiry}`,
            conviction: top.conviction,
            entry: `$${top.entryLow}–$${top.entryHigh}`,
            target: `$${top.targetLow}+`,
            stop: `$${top.stopPremium}`,
            invalidation: top.invalidation,
          }
        : null,
    })
  );

  console.log(`✅ ${session} scan complete (${dataMode}).`);
}

main().catch((e) => {
  console.error("Scan failed:", e);
  process.exit(1);
});
