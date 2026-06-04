import type {
  Quote,
  MarketSnapshot,
  TradeIdea,
  ConvictionBreakdown,
  Direction,
  RiskLevel,
  NewsItem,
  AnalystAction,
  SectorPerf,
} from "../types";
import { analyzeTechnicals } from "./technical";
import { selectContract } from "./options";
import { fmtUsd } from "../lib/format";

// Conviction weights — must sum to 1. Mirrors the product spec.
export const WEIGHTS = {
  catalyst: 0.2,
  technical: 0.2,
  liquidity: 0.15,
  marketAlignment: 0.15,
  sectorStrength: 0.1,
  riskReward: 0.1,
  newsQuality: 0.05,
  volatility: 0.05,
} as const;

export interface CatalystRead {
  score: number; // 0-10
  newsQuality: number; // 0-10
  drivers: string[];
  netSentiment: number; // -1..1
}

export function analyzeCatalyst(
  ticker: string,
  news: NewsItem[],
  analyst: AnalystAction[]
): CatalystRead {
  const tNews = news.filter((n) => n.ticker === ticker);
  const tAnalyst = analyst.filter((a) => a.ticker === ticker);
  const drivers: string[] = [];
  let score = 3; // neutral baseline
  let qualitySum = 0;
  let qualityN = 0;
  let net = 0;

  for (const n of tNews) {
    const impactW = n.impact === "high" ? 3 : n.impact === "medium" ? 1.6 : 0.6;
    score += impactW * Math.abs(n.sentimentScore);
    net += n.sentimentScore;
    qualitySum += n.impact === "high" ? 9 : n.impact === "medium" ? 6.5 : 4;
    qualityN += 1;
    drivers.push(n.headline);
  }
  for (const a of tAnalyst) {
    if (a.action === "upgrade") {
      score += 1.4;
      net += 0.4;
      drivers.push(`${a.firm} upgrade to ${a.toRating}`);
    } else if (a.action === "downgrade") {
      score += 1.4;
      net -= 0.4;
      drivers.push(`${a.firm} downgrade to ${a.toRating}`);
    } else if (a.action === "pt_change" && a.priceTarget && a.prevTarget) {
      const up = a.priceTarget > a.prevTarget;
      score += 0.8;
      net += up ? 0.2 : -0.2;
      drivers.push(
        `${a.firm} PT ${up ? "raised" : "cut"} to ${fmtUsd(a.priceTarget, 0)}`
      );
    }
  }

  score = Math.max(0, Math.min(10, score));
  const newsQuality = qualityN ? qualitySum / qualityN : 3;
  return {
    score: Number(score.toFixed(1)),
    newsQuality: Number(newsQuality.toFixed(1)),
    drivers,
    netSentiment: Number((tNews.length || tAnalyst.length ? net : 0).toFixed(2)),
  };
}

function sectorScoreFor(q: Quote, sectors: SectorPerf[], dir: Direction): number {
  const s = sectors.find((x) => x.sector === q.sector);
  if (!s) return 5;
  // bullish trades want strong sectors, bearish trades want weak sectors
  const aligned = dir === "bearish" ? -s.relStrength : s.relStrength;
  return Math.max(0, Math.min(10, 5 + aligned * 2.2));
}

function marketAlignmentScore(snap: MarketSnapshot, dir: Direction): number {
  const qqq = snap.indices.find((i) => i.symbol === "QQQ")?.changePct ?? 0;
  const spy = snap.indices.find((i) => i.symbol === "SPY")?.changePct ?? 0;
  const breadth =
    (snap.advancers - snap.decliners) / (snap.advancers + snap.decliners);
  const tape = (qqq + spy) / 2 + breadth * 2 - snap.vixChangePct * 0.05;
  const aligned = dir === "bearish" ? -tape : tape;
  return Math.max(0, Math.min(10, 5 + aligned * 1.6));
}

function volatilityScore(q: Quote, dir: Direction): number {
  // Buying premium is best when IV rank is moderate-low (cheaper) but there is
  // enough vol to move. Penalise very high IV rank (expensive / crush risk).
  if (q.ivRank > 75) return 3.5;
  if (q.ivRank > 60) return 5;
  if (q.ivRank < 20) return 6;
  return 8; // 20-60 sweet spot
}

function riskRewardScore(
  entry: number,
  target: number,
  stop: number
): { score: number; rr: number } {
  const reward = target - entry;
  const risk = entry - stop;
  const rr = risk > 0 ? reward / risk : 0;
  const score = Math.max(0, Math.min(10, rr * 3.3));
  return { score: Number(score.toFixed(1)), rr };
}

function riskLevelFor(q: Quote, conviction: number, earningsRisk: boolean): RiskLevel {
  if (q.iv > 0.7 || (earningsRisk && q.ivRank > 60)) return "Very High";
  if (q.iv > 0.45 || q.beta > 1.6) return "High";
  if (q.iv > 0.3) return "Medium";
  return "Low";
}

export interface ConvictionResult {
  idea: TradeIdea | null;
  rawScore: number;
}

export function buildTradeIdea(
  q: Quote,
  snap: MarketSnapshot,
  forcedDirection?: Direction
): ConvictionResult {
  const tech = analyzeTechnicals(q);
  const cat = analyzeCatalyst(q.ticker, snap.news, snap.analyst);

  // Decide direction: blend technicals and catalyst sentiment.
  let direction: Direction = forcedDirection ?? tech.direction;
  if (!forcedDirection) {
    const lean = (tech.direction === "bullish" ? 1 : tech.direction === "bearish" ? -1 : 0)
      + cat.netSentiment * 1.5;
    direction = lean > 0.3 ? "bullish" : lean < -0.3 ? "bearish" : tech.direction;
  }
  if (direction === "neutral") direction = q.changePct >= 0 ? "bullish" : "bearish";

  const chain = snap.optionChains[q.ticker] ?? [];
  const sel = selectContract(q, chain, direction);
  if (!sel) return { idea: null, rawScore: 0 };

  const rr = riskRewardScore(
    (sel.entryLow + sel.entryHigh) / 2,
    (sel.targetLow + sel.targetHigh) / 2,
    sel.stopPremium
  );

  // earnings risk: contract expiry past a known earnings date inside window
  const earn = snap.earnings.find((e) => e.ticker === q.ticker);
  const earningsRisk = !!earn && new Date(earn.date) <= new Date(sel.contract.expiry);

  const breakdown: ConvictionBreakdown = {
    catalyst: cat.score,
    technical:
      direction === "bearish" ? 10 - tech.score : tech.score, // invert for puts
    liquidity: sel.liquidity.score,
    marketAlignment: marketAlignmentScore(snap, direction),
    sectorStrength: sectorScoreFor(q, snap.sectors, direction),
    riskReward: rr.score,
    newsQuality: cat.newsQuality,
    volatility: volatilityScore(q, direction),
  };

  const weighted =
    breakdown.catalyst * WEIGHTS.catalyst +
    breakdown.technical * WEIGHTS.technical +
    breakdown.liquidity * WEIGHTS.liquidity +
    breakdown.marketAlignment * WEIGHTS.marketAlignment +
    breakdown.sectorStrength * WEIGHTS.sectorStrength +
    breakdown.riskReward * WEIGHTS.riskReward +
    breakdown.newsQuality * WEIGHTS.newsQuality +
    breakdown.volatility * WEIGHTS.volatility;

  const conviction = Number(weighted.toFixed(1));
  const riskLevel = riskLevelFor(q, conviction, earningsRisk);

  const stopStock =
    direction === "bearish"
      ? Number((q.resistance * 1.001).toFixed(2))
      : Number((q.support * 0.999).toFixed(2));

  const bullCase = buildBullCase(q, tech, cat, snap, direction);
  const bearCase = buildBearCase(q, tech, snap, direction, earningsRisk);

  const thesis = buildThesis(q, tech, cat, direction, snap);

  const invalidation =
    direction === "bearish"
      ? `Setup is invalid if ${q.ticker} reclaims ${fmtUsd(q.resistance)} or if QQQ breaks back above its key resistance.`
      : `Setup is invalid if ${q.ticker} loses ${fmtUsd(q.support)} or if QQQ loses its key support level.`;

  const idea: TradeIdea = {
    id: `${q.ticker}-${sel.contract.strike}-${sel.contract.type}-${sel.contract.expiry}`,
    ticker: q.ticker,
    name: q.name,
    direction,
    optionType: sel.contract.type,
    contract: sel.contract,
    spotAtRec: q.price,
    entryLow: sel.entryLow,
    entryHigh: sel.entryHigh,
    targetLow: sel.targetLow,
    targetHigh: sel.targetHigh,
    stopPremium: sel.stopPremium,
    stopStock,
    invalidation,
    riskLevel,
    conviction,
    breakdown,
    bullCase,
    bearCase,
    thesis,
    probProfit: sel.probProfit,
    expectedMovePct: sel.expectedMovePct,
    earningsRisk,
    maxLossPerContract: sel.maxLossPerContract,
    suggestedRiskPct: conviction >= 8 ? 2 : conviction >= 6.5 ? 1.5 : 1,
  };

  return { idea, rawScore: conviction };
}

function buildBullCase(
  q: Quote,
  tech: ReturnType<typeof analyzeTechnicals>,
  cat: CatalystRead,
  snap: MarketSnapshot,
  dir: Direction
): string[] {
  if (dir === "bearish") {
    // "bull case" for a put = reasons the bearish thesis works
    const out: string[] = [];
    if (cat.netSentiment < 0) out.push("Negative catalyst / news flow");
    if (tech.maStack === "bearish") out.push("Bearish moving-average stack");
    if (q.relStrength < -10) out.push("Lagging the broad market");
    const sec = snap.sectors.find((s) => s.sector === q.sector);
    if (sec && sec.relStrength < 0) out.push(`${q.sector} sector is weak`);
    if (tech.nearBreakdown) out.push(`Pressing support at ${fmtUsd(q.support)}`);
    out.push("Heavy put flow / bearish positioning");
    return out;
  }
  const out: string[] = [];
  if (cat.netSentiment > 0.2) out.push("Strong positive catalyst");
  if (q.relStrength > 15) out.push(`High relative strength vs SPY (+${q.relStrength})`);
  if (tech.maStack === "bullish") out.push("Clean breakout above key moving averages");
  const sec = snap.sectors.find((s) => s.sector === q.sector);
  if (sec && sec.relStrength > 0) out.push(`${q.sector} sector momentum is positive`);
  const flow = snap.flow.filter((f) => f.ticker === q.ticker && f.sentiment === "bullish");
  if (flow.length) out.push("Heavy call volume / bullish sweeps");
  if (q.volume / q.avgVolume > 1.4) out.push("Volume well above average");
  return out.length ? out : ["Constructive price action and supportive tape"];
}

function buildBearCase(
  q: Quote,
  tech: ReturnType<typeof analyzeTechnicals>,
  snap: MarketSnapshot,
  dir: Direction,
  earningsRisk: boolean
): string[] {
  const out: string[] = [];
  if (q.ivRank > 55)
    out.push("Option premiums are expensive due to elevated implied volatility");
  if (earningsRisk) out.push("Earnings inside the trade window — IV-crush / gap risk");
  if (dir === "bullish") {
    out.push("Market could reverse if QQQ rejects resistance");
    if (q.rsi > 68) out.push("RSI extended — profit-taking risk after a large move");
    out.push("Theta decay will hurt if the stock consolidates");
  } else {
    out.push("Sharp short-covering bounce risk if the tape turns up");
    if (q.rsi < 32) out.push("RSI oversold — mean-reversion bounce possible");
    out.push("Theta decay will hurt if the stock stalls instead of falling");
  }
  return out;
}

function buildThesis(
  q: Quote,
  tech: ReturnType<typeof analyzeTechnicals>,
  cat: CatalystRead,
  dir: Direction,
  snap: MarketSnapshot
): string {
  const sec = snap.sectors.find((s) => s.sector === q.sector);
  const dirWord = dir === "bullish" ? "bullish" : "bearish";
  const catLine = cat.drivers.length
    ? `Catalyst: ${cat.drivers[0]}. `
    : "No single dominant catalyst, but the setup is technically driven. ";
  return (
    `${q.ticker} is showing ${dirWord} momentum. ${catLine}` +
    `${tech.plainEnglish}` +
    (sec ? `The ${q.sector} sector is ${sec.rotation}. ` : "") +
    `Net news sentiment reads ${cat.netSentiment > 0 ? "positive" : cat.netSentiment < 0 ? "negative" : "neutral"}.`
  );
}
