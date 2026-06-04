import type {
  MarketSnapshot,
  MarketReport,
  ReportType,
  TradeIdea,
  ScoredTicker,
  Direction,
} from "../types";
import { analyzeSentiment, SENTIMENT_META, BIAS_META } from "./sentiment";
import { buildTradeIdea, analyzeCatalyst } from "./conviction";
import { analyzeTechnicals } from "./technical";
import { fmtUsd, fmtPct } from "../lib/format";

// ----------------------------------------------------------------------------
// Report engine. Runs the full pipeline for a session and produces a complete,
// AI-style structured report: sentiment, setups, earnings, the highest-
// conviction idea, key levels, and a game plan.
// ----------------------------------------------------------------------------

export interface ScanResult {
  snapshot: MarketSnapshot;
  report: MarketReport;
  allIdeas: TradeIdea[];
}

export function runScan(snap: MarketSnapshot, type: ReportType): ScanResult {
  const sentiment = analyzeSentiment(snap);

  // Score every ticker into a trade idea, keep tradeable ones.
  const ideas: TradeIdea[] = [];
  for (const q of snap.quotes) {
    const { idea } = buildTradeIdea(q, snap);
    if (idea) ideas.push(idea);
  }
  ideas.sort((a, b) => b.conviction - a.conviction);

  const bullIdeas = ideas.filter((i) => i.direction === "bullish");
  const bearIdeas = ideas.filter((i) => i.direction === "bearish");

  const topIdea = ideas[0];
  const altCallIdea = bullIdeas.find((i) => i.id !== topIdea?.id);
  const altPutIdea = bearIdeas.find((i) => i.id !== topIdea?.id);

  const bullishSetups = toScored(snap, bullIdeas.slice(0, 5), "bullish");
  const bearishSetups = toScored(snap, bearIdeas.slice(0, 5), "bearish");

  const strongestSectors = snap.sectors.slice(0, 3);
  const weakestSectors = snap.sectors.slice(-3).reverse();

  const earningsToWatch = snap.earnings
    .slice()
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .slice(0, 4);

  const drivers = buildDrivers(snap);
  const keyLevels = buildKeyLevels(snap);
  const gamePlan = buildGamePlan(snap, sentiment, topIdea, type);
  const narrative = buildNarrative(snap, sentiment, type, topIdea);

  const headline =
    type === "morning"
      ? `Morning Prep — ${SENTIMENT_META[sentiment.label].text} open, ${BIAS_META[sentiment.bias].toLowerCase()}`
      : `Evening Recap — ${SENTIMENT_META[sentiment.label].text} close, game plan for tomorrow`;

  const report: MarketReport = {
    type,
    generatedAt: snap.asOf,
    sentiment,
    headline,
    drivers,
    strongestSectors,
    weakestSectors,
    bullishSetups,
    bearishSetups,
    earningsToWatch,
    topIdea,
    altCallIdea,
    altPutIdea,
    keyLevels,
    gamePlan,
    narrative,
    riskWarning:
      "Options trading is risky and can result in the loss of the entire premium paid. " +
      "This report provides analysis and educational information only — not financial advice. " +
      "Size positions small (1–2% of capital per idea), honor stops, and do your own research.",
  };

  return { snapshot: snap, report, allIdeas: ideas };
}

function toScored(
  snap: MarketSnapshot,
  ideas: TradeIdea[],
  dir: Direction
): ScoredTicker[] {
  return ideas.map((i) => {
    const q = snap.quotes.find((x) => x.ticker === i.ticker)!;
    const cat = analyzeCatalyst(i.ticker, snap.news, snap.analyst);
    const reason = cat.drivers[0] ?? analyzeTechnicals(q).trend;
    return {
      ticker: i.ticker,
      name: i.name,
      score: i.conviction,
      direction: dir,
      reason,
      changePct: q.changePct,
      relStrength: q.relStrength,
    };
  });
}

function buildDrivers(snap: MarketSnapshot): string[] {
  const out: string[] = [];
  const high = snap.news.filter((n) => n.impact === "high");
  for (const n of high.slice(0, 4)) {
    out.push(`${n.kind === "macro" ? "Macro" : n.ticker}: ${n.headline}`);
  }
  const macro = snap.macro.find((m) => m.symbol === "US10Y");
  if (macro) out.push(`10Y yield at ${macro.value}%, VIX ${snap.vix}`);
  return out;
}

function buildKeyLevels(snap: MarketSnapshot): { ticker: string; note: string }[] {
  const interesting = snap.quotes
    .map((q) => ({ q, tech: analyzeTechnicals(q) }))
    .filter((x) => x.tech.nearBreakout || x.tech.nearBreakdown || Math.abs(x.q.changePct) > 1.5)
    .slice(0, 6);
  const levels = interesting.map(({ q, tech }) => ({
    ticker: q.ticker,
    note: tech.nearBreakout
      ? `Breakout trigger ${fmtUsd(q.resistance)} (support ${fmtUsd(q.support)})`
      : tech.nearBreakdown
      ? `Breakdown trigger ${fmtUsd(q.support)} (resistance ${fmtUsd(q.resistance)})`
      : `Range ${fmtUsd(q.support)} – ${fmtUsd(q.resistance)}`,
  }));
  const spy = snap.indices.find((i) => i.symbol === "SPY");
  const qqq = snap.indices.find((i) => i.symbol === "QQQ");
  if (spy) levels.unshift({ ticker: "SPY", note: `Pivot ${fmtUsd(spy.price)} — bulls want to hold above` });
  if (qqq) levels.unshift({ ticker: "QQQ", note: `Leading the tape at ${fmtUsd(qqq.price)} — key for risk appetite` });
  return levels;
}

function buildGamePlan(
  snap: MarketSnapshot,
  sentiment: ReturnType<typeof analyzeSentiment>,
  top: TradeIdea | undefined,
  type: ReportType
): string[] {
  const plan: string[] = [];
  plan.push(
    `Bias into ${type === "morning" ? "the open" : "tomorrow"}: ${SENTIMENT_META[sentiment.label].text} — ${BIAS_META[sentiment.bias].toLowerCase()}.`
  );
  if (sentiment.bias === "watch_only" || sentiment.bias === "cash") {
    plan.push("Signals are conflicted — let the first 30 minutes set the tone before committing risk.");
  }
  const qqq = snap.indices.find((i) => i.symbol === "QQQ");
  if (qqq) plan.push(`Use QQQ ${fmtUsd(qqq.price)} as the risk-on/off line; trade with it, not against it.`);
  if (top) {
    plan.push(
      `Primary idea: ${top.ticker} ${top.optionType.toUpperCase()} — enter ${fmtUsd(top.entryLow)}–${fmtUsd(top.entryHigh)}, target ${fmtUsd(top.targetLow)}+, stop ${fmtUsd(top.stopPremium)}.`
    );
  }
  const earnSoon = snap.earnings.filter(
    (e) => +new Date(e.date) - Date.now() < 2 * 86400000
  );
  if (earnSoon.length)
    plan.push(
      `Earnings risk: ${earnSoon.map((e) => `${e.ticker} (${e.time.toUpperCase()})`).join(", ")} — avoid holding short premium through the print.`
    );
  plan.push("Keep total options exposure modest; one A+ setup beats five marginal ones.");
  return plan;
}

function buildNarrative(
  snap: MarketSnapshot,
  sentiment: ReturnType<typeof analyzeSentiment>,
  type: ReportType,
  top: TradeIdea | undefined
): string {
  const spy = snap.indices.find((i) => i.symbol === "SPY");
  const qqq = snap.indices.find((i) => i.symbol === "QQQ");
  const lead = snap.sectors[0];
  const lag = snap.sectors[snap.sectors.length - 1];
  const winners = snap.quotes.slice().sort((a, b) => b.changePct - a.changePct).slice(0, 2);
  const losers = snap.quotes.slice().sort((a, b) => a.changePct - b.changePct).slice(0, 2);

  if (type === "morning") {
    return (
      `Futures point to a ${sentiment.score >= 0 ? "firmer" : "softer"} open with ` +
      `${qqq ? `QQQ ${fmtPct(qqq.changePct)}` : "tech"} ${spy ? `and SPY ${fmtPct(spy.changePct)}` : ""}. ` +
      `${sentiment.summary} ${lead ? `${lead.sector} (${fmtPct(lead.changePct)}) is leading while ${lag.sector} (${fmtPct(lag.changePct)}) lags. ` : ""}` +
      `Premarket strength in ${winners.map((w) => w.ticker).join(", ")}; weakness in ${losers.map((w) => w.ticker).join(", ")}. ` +
      (top ? `The desk's highest-conviction setup is ${top.ticker} (${top.conviction.toFixed(1)}/10).` : "")
    );
  }
  return (
    `Stocks closed ${sentiment.score >= 0 ? "higher" : "lower"} with ` +
    `${spy ? `SPY ${fmtPct(spy.changePct)}` : ""} ${qqq ? `and QQQ ${fmtPct(qqq.changePct)}` : ""}. ` +
    `${sentiment.summary} Leadership came from ${lead?.sector ?? "tech"}; ${lag?.sector ?? "energy"} lagged. ` +
    `Today's standouts: ${winners.map((w) => `${w.ticker} ${fmtPct(w.changePct)}`).join(", ")}. ` +
    `Laggards: ${losers.map((w) => `${w.ticker} ${fmtPct(w.changePct)}`).join(", ")}. ` +
    (top ? `Carrying ${top.ticker} as the top idea into tomorrow (${top.conviction.toFixed(1)}/10).` : "")
  );
}
