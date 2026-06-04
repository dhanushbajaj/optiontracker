import type {
  MarketSnapshot,
  SentimentResult,
  SentimentLabel,
  EnvironmentBias,
  Direction,
} from "../types";

// ----------------------------------------------------------------------------
// Market sentiment engine. Aggregates index trend, futures, VIX, breadth,
// yields, dollar, sector rotation, mega-cap tech and news into a single
// -100..100 score, a label, and a recommended trading environment.
// ----------------------------------------------------------------------------

interface Driver {
  label: string;
  value: string;
  weight: number;
  signal: Direction;
  contribution: number; // signed, pre-normalisation
}

export function analyzeSentiment(snap: MarketSnapshot): SentimentResult {
  const drivers: Driver[] = [];
  const add = (
    label: string,
    value: string,
    weight: number,
    contribution: number
  ) =>
    drivers.push({
      label,
      value,
      weight,
      contribution,
      signal: contribution > 0.05 ? "bullish" : contribution < -0.05 ? "bearish" : "neutral",
    });

  const spy = snap.indices.find((i) => i.symbol === "SPY");
  const qqq = snap.indices.find((i) => i.symbol === "QQQ");
  const iwm = snap.indices.find((i) => i.symbol === "IWM");

  if (spy) add("SPY trend", `${spy.changePct > 0 ? "+" : ""}${spy.changePct}%`, 18, clamp(spy.changePct / 1.5));
  if (qqq) add("QQQ / mega-cap tech", `${qqq.changePct > 0 ? "+" : ""}${qqq.changePct}%`, 16, clamp(qqq.changePct / 1.5));

  const futures = snap.indices.find((i) => i.futuresChangePct != null);
  if (futures?.futuresChangePct != null)
    add("Index futures", `${futures.futuresChangePct > 0 ? "+" : ""}${futures.futuresChangePct}%`, 8, clamp(futures.futuresChangePct / 1.2));

  add("VIX", `${snap.vix} (${snap.vixChangePct > 0 ? "+" : ""}${snap.vixChangePct}%)`, 14, clamp(-snap.vixChangePct / 6) + clamp((18 - snap.vix) / 12) * 0.4);

  const breadth = (snap.advancers - snap.decliners) / (snap.advancers + snap.decliners);
  add("Market breadth (A/D)", `${snap.advancers} adv / ${snap.decliners} dec`, 12, clamp(breadth * 2));

  if (iwm) add("Small caps (IWM)", `${iwm.changePct > 0 ? "+" : ""}${iwm.changePct}%`, 6, clamp(iwm.changePct / 1.5));

  const y10 = snap.macro.find((m) => m.symbol === "US10Y");
  if (y10) add("10Y yield", `${y10.value}%`, 8, clamp(-y10.changePct / 4));

  const dxy = snap.macro.find((m) => m.symbol === "DXY");
  if (dxy) add("Dollar (DXY)", `${dxy.value}`, 5, clamp(-dxy.changePct / 2));

  const leadingSectors = snap.sectors.filter((s) => s.rotation === "leading").length;
  const laggingSectors = snap.sectors.filter((s) => s.rotation === "lagging").length;
  add("Sector rotation", `${leadingSectors} leading / ${laggingSectors} lagging`, 8, clamp((leadingSectors - laggingSectors) / 4));

  const newsNet =
    snap.news.reduce((s, n) => {
      const w = n.impact === "high" ? 1.5 : n.impact === "medium" ? 1 : 0.5;
      return s + n.sentimentScore * w;
    }, 0) / Math.max(1, snap.news.length);
  add("News flow", newsNet > 0 ? "net positive" : newsNet < 0 ? "net negative" : "mixed", 5, clamp(newsNet * 2));

  const totalWeight = drivers.reduce((s, d) => s + d.weight, 0);
  const weighted = drivers.reduce((s, d) => s + d.contribution * d.weight, 0);
  const score = Math.round(clamp(weighted / totalWeight) * 100);

  const label = labelFor(score, drivers);
  const bias = biasFor(score, snap);
  const summary = summarize(score, label, bias, snap, drivers);

  return {
    score,
    label,
    bias,
    drivers: drivers
      .sort((a, b) => Math.abs(b.contribution * b.weight) - Math.abs(a.contribution * a.weight))
      .map(({ label, value, weight, signal }) => ({ label, value, weight, signal })),
    summary,
  };
}

function clamp(n: number) {
  return Math.max(-1, Math.min(1, n));
}

function labelFor(score: number, drivers: Driver[]): SentimentLabel {
  // detect "mixed": signals strongly disagree
  const bullW = drivers.filter((d) => d.signal === "bullish").reduce((s, d) => s + d.weight, 0);
  const bearW = drivers.filter((d) => d.signal === "bearish").reduce((s, d) => s + d.weight, 0);
  const conflict = Math.min(bullW, bearW) / Math.max(bullW, bearW || 1);
  if (Math.abs(score) < 18 && conflict > 0.55) return "mixed";
  if (score >= 55) return "strong_bullish";
  if (score >= 20) return "bullish";
  if (score > -20) return "neutral";
  if (score > -55) return "bearish";
  return "strong_bearish";
}

function biasFor(score: number, snap: MarketSnapshot): EnvironmentBias {
  const highVol = snap.vix > 22;
  if (highVol && Math.abs(score) < 30) return "straddles";
  if (score >= 40) return "calls";
  if (score <= -40) return "puts";
  if (Math.abs(score) >= 20) return "spreads";
  if (Math.abs(score) < 12) return "watch_only";
  return "spreads";
}

export const SENTIMENT_META: Record<SentimentLabel, { text: string; tone: Direction }> = {
  strong_bullish: { text: "Strong Bullish", tone: "bullish" },
  bullish: { text: "Bullish", tone: "bullish" },
  neutral: { text: "Neutral", tone: "neutral" },
  mixed: { text: "Mixed", tone: "neutral" },
  bearish: { text: "Bearish", tone: "bearish" },
  strong_bearish: { text: "Strong Bearish", tone: "bearish" },
};

export const BIAS_META: Record<EnvironmentBias, string> = {
  calls: "Favor calls / long delta",
  puts: "Favor puts / short delta",
  spreads: "Favor defined-risk spreads",
  straddles: "Favor straddles / strangles (vol)",
  watch_only: "Watch only — wait for confirmation",
  cash: "Stay in cash",
};

function summarize(
  score: number,
  label: SentimentLabel,
  bias: EnvironmentBias,
  snap: MarketSnapshot,
  drivers: Driver[]
): string {
  const top = drivers
    .slice()
    .sort((a, b) => Math.abs(b.contribution * b.weight) - Math.abs(a.contribution * a.weight))
    .slice(0, 3)
    .map((d) => d.label.toLowerCase());
  return (
    `Composite sentiment ${score >= 0 ? "+" : ""}${score} (${SENTIMENT_META[label].text}). ` +
    `The tape is being driven mainly by ${top.join(", ")}. ` +
    `VIX at ${snap.vix} (${snap.vixChangePct > 0 ? "+" : ""}${snap.vixChangePct}%). ` +
    `Environment read: ${BIAS_META[bias].toLowerCase()}.`
  );
}
