import type { Quote, Direction } from "../types";

// ----------------------------------------------------------------------------
// Technical analysis engine. Produces a 0-10 technical score plus a plain-
// English read of the setup, used by both the conviction engine and the UI.
// ----------------------------------------------------------------------------

export interface TechnicalRead {
  score: number; // 0-10
  direction: Direction;
  trend: string;
  signals: string[];
  aboveVwap: boolean;
  maStack: "bullish" | "bearish" | "mixed";
  rsiState: "overbought" | "oversold" | "neutral";
  nearBreakout: boolean;
  nearBreakdown: boolean;
  plainEnglish: string;
}

export function analyzeTechnicals(q: Quote): TechnicalRead {
  const signals: string[] = [];
  let bull = 0;
  let bear = 0;

  const aboveVwap = q.price > q.vwap;
  if (aboveVwap) {
    bull += 1;
    signals.push("Trading above VWAP");
  } else {
    bear += 1;
    signals.push("Trading below VWAP");
  }

  // moving-average stack
  const stackBull = q.price > q.sma20 && q.sma20 > q.sma50 && q.sma50 > q.sma200;
  const stackBear = q.price < q.sma20 && q.sma20 < q.sma50 && q.sma50 < q.sma200;
  const maStack = stackBull ? "bullish" : stackBear ? "bearish" : "mixed";
  if (stackBull) {
    bull += 2;
    signals.push("Clean bullish MA stack (20 > 50 > 200)");
  } else if (stackBear) {
    bear += 2;
    signals.push("Bearish MA stack (price < 20 < 50 < 200)");
  } else {
    if (q.price > q.sma50) {
      bull += 0.5;
      signals.push("Above the 50-day MA");
    } else {
      bear += 0.5;
      signals.push("Below the 50-day MA");
    }
  }

  // RSI
  const rsiState =
    q.rsi >= 70 ? "overbought" : q.rsi <= 30 ? "oversold" : "neutral";
  if (q.rsi >= 55 && q.rsi < 70) {
    bull += 1;
    signals.push(`RSI ${q.rsi.toFixed(0)} — bullish momentum`);
  } else if (q.rsi >= 70) {
    signals.push(`RSI ${q.rsi.toFixed(0)} — overbought, watch for exhaustion`);
  } else if (q.rsi <= 45 && q.rsi > 30) {
    bear += 1;
    signals.push(`RSI ${q.rsi.toFixed(0)} — weak momentum`);
  } else if (q.rsi <= 30) {
    signals.push(`RSI ${q.rsi.toFixed(0)} — oversold, bounce risk`);
  }

  // MACD
  if (q.macdHist > 0.1) {
    bull += 1;
    signals.push("MACD histogram positive and rising");
  } else if (q.macdHist < -0.1) {
    bear += 1;
    signals.push("MACD histogram negative");
  }

  // relative strength
  if (q.relStrength > 25) {
    bull += 1.5;
    signals.push(`Strong relative strength vs SPY (+${q.relStrength})`);
  } else if (q.relStrength < -25) {
    bear += 1.5;
    signals.push(`Lagging SPY (${q.relStrength})`);
  }

  // relative volume
  const relVol = q.volume / q.avgVolume;
  if (relVol > 1.5) {
    signals.push(`Relative volume ${relVol.toFixed(1)}x — conviction behind the move`);
    if (q.changePct >= 0) bull += 0.5;
    else bear += 0.5;
  }

  // proximity to key levels
  const toRes = (q.resistance - q.price) / q.price;
  const toSup = (q.price - q.support) / q.price;
  const nearBreakout = toRes > 0 && toRes < 0.015;
  const nearBreakdown = toSup > 0 && toSup < 0.015;
  if (nearBreakout) {
    bull += 1;
    signals.push(`Coiled just under resistance ${q.resistance} — breakout setup`);
  }
  if (nearBreakdown) {
    bear += 1;
    signals.push(`Pressing support ${q.support} — breakdown risk`);
  }

  const net = bull - bear;
  const direction: Direction = net > 1 ? "bullish" : net < -1 ? "bearish" : "neutral";
  const raw = 5 + net * 0.85;
  const score = Math.max(0, Math.min(10, Number(raw.toFixed(1))));

  const trend =
    maStack === "bullish"
      ? "Uptrend"
      : maStack === "bearish"
      ? "Downtrend"
      : "Range / transition";

  const dirWord =
    direction === "bullish"
      ? "constructive"
      : direction === "bearish"
      ? "vulnerable"
      : "balanced";
  const plainEnglish =
    `${q.ticker} looks technically ${dirWord}. ${trend.toLowerCase()} with price ` +
    `${aboveVwap ? "holding above" : "stuck below"} VWAP and an RSI of ${q.rsi.toFixed(0)}. ` +
    (nearBreakout
      ? `It is sitting right under ${q.resistance}; a clean break opens room higher. `
      : nearBreakdown
      ? `It is leaning on ${q.support}; losing that level invites more selling. `
      : `Key levels: support ${q.support}, resistance ${q.resistance}. `);

  return {
    score,
    direction,
    trend,
    signals,
    aboveVwap,
    maStack,
    rsiState,
    nearBreakout,
    nearBreakdown,
    plainEnglish,
  };
}
