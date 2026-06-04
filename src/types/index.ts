// ============================================================================
// Domain types for Option Oracle.
// These are shared by the data-provider layer, the analysis engines, and the UI.
// ============================================================================

export type Direction = "bullish" | "bearish" | "neutral";

export type SentimentLabel =
  | "strong_bullish"
  | "bullish"
  | "neutral"
  | "mixed"
  | "bearish"
  | "strong_bearish";

export type EnvironmentBias =
  | "calls"
  | "puts"
  | "spreads"
  | "straddles"
  | "watch_only"
  | "cash";

export type RiskLevel = "Low" | "Medium" | "High" | "Very High";

export type NewsImpact = "high" | "medium" | "low";
export type NewsKind =
  | "bullish_catalyst"
  | "bearish_catalyst"
  | "neutral"
  | "macro";

export interface Quote {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  prevClose: number;
  changePct: number; // intraday/last session % change
  premarketChangePct?: number;
  volume: number;
  avgVolume: number;
  marketCap?: number;
  // technical context
  vwap: number;
  sma20: number;
  sma50: number;
  sma200: number;
  rsi: number;
  macdHist: number; // MACD histogram value
  high52: number;
  low52: number;
  dayHigh: number;
  dayLow: number;
  prevHigh: number;
  prevLow: number;
  // key levels
  support: number;
  resistance: number;
  // implied/realized vol
  iv: number; // annualized implied vol, e.g. 0.45
  ivRank: number; // 0-100
  hv: number; // historical vol
  // relative strength vs SPY (-100..100)
  relStrength: number;
  beta: number;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  futuresChangePct?: number;
}

export interface MacroQuote {
  symbol: string;
  name: string;
  value: number;
  changePct: number;
  unit?: string;
  proxyOf?: string; // set when value is an ETF proxy (e.g. TLT for US10Y)
}

export interface SectorPerf {
  sector: string;
  etf: string;
  changePct: number;
  relStrength: number; // vs SPY
  rotation: "leading" | "improving" | "weakening" | "lagging";
}

export interface NewsItem {
  id: string;
  ticker?: string;
  headline: string;
  source: string;
  time: string; // ISO
  summary: string;
  kind: NewsKind;
  impact: NewsImpact;
  sentimentScore: number; // -1..1
}

export interface AnalystAction {
  id: string;
  ticker: string;
  firm: string;
  action: "upgrade" | "downgrade" | "initiate" | "reiterate" | "pt_change";
  fromRating?: string;
  toRating?: string;
  priceTarget?: number;
  prevTarget?: number;
  time: string;
}

export interface EarningsEvent {
  ticker: string;
  name: string;
  date: string; // ISO date
  time: "bmo" | "amc" | "during"; // before/after market or during
  epsEstimate: number;
  epsActual?: number;
  revEstimate: number; // in millions
  revActual?: number;
  impliedMovePct: number; // from straddle pricing
  histAvgMovePct: number;
  ivRank: number;
  guidance?: "raised" | "inline" | "cut";
}

export interface OptionContract {
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiry: string; // ISO date
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionsFlowItem {
  id: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  premium: number; // total $ traded
  size: number; // contracts
  spotRef: number;
  sentiment: "bullish" | "bearish";
  kind: "sweep" | "block" | "split";
  aggressor: "ask" | "bid" | "mid";
  time: string;
}

// ---- Scored / derived structures produced by the engines ----------------

export interface ConvictionBreakdown {
  catalyst: number; // 0-10 each, pre-weight
  technical: number;
  liquidity: number;
  marketAlignment: number;
  sectorStrength: number;
  riskReward: number;
  newsQuality: number;
  volatility: number;
}

export interface TradeIdea {
  id: string;
  ticker: string;
  name: string;
  direction: Direction;
  optionType: "call" | "put";
  contract: OptionContract;
  spotAtRec: number;
  entryLow: number;
  entryHigh: number;
  targetLow: number;
  targetHigh: number;
  stopPremium: number;
  stopStock: number;
  invalidation: string;
  riskLevel: RiskLevel;
  conviction: number; // 0-10 weighted
  breakdown: ConvictionBreakdown;
  bullCase: string[];
  bearCase: string[];
  thesis: string;
  probProfit: number; // 0-1
  expectedMovePct: number;
  earningsRisk: boolean;
  maxLossPerContract: number;
  suggestedRiskPct: number;
}

export interface SentimentResult {
  score: number; // -100..100
  label: SentimentLabel;
  bias: EnvironmentBias;
  drivers: { label: string; value: string; weight: number; signal: Direction }[];
  summary: string;
}

export interface MarketSnapshot {
  asOf: string;
  indices: IndexQuote[];
  macro: MacroQuote[];
  quotes: Quote[];
  sectors: SectorPerf[];
  news: NewsItem[];
  analyst: AnalystAction[];
  earnings: EarningsEvent[];
  flow: OptionsFlowItem[];
  optionChains: Record<string, OptionContract[]>;
  vix: number;
  vixChangePct: number;
  advancers: number;
  decliners: number;
}

export type ReportType = "morning" | "evening";

export interface MarketReport {
  type: ReportType;
  generatedAt: string;
  sentiment: SentimentResult;
  headline: string;
  drivers: string[];
  strongestSectors: SectorPerf[];
  weakestSectors: SectorPerf[];
  bullishSetups: ScoredTicker[];
  bearishSetups: ScoredTicker[];
  earningsToWatch: EarningsEvent[];
  topIdea: TradeIdea;
  altCallIdea?: TradeIdea;
  altPutIdea?: TradeIdea;
  keyLevels: { ticker: string; note: string }[];
  gamePlan: string[];
  narrative: string;
  riskWarning: string;
}

export interface ScoredTicker {
  ticker: string;
  name: string;
  score: number;
  direction: Direction;
  reason: string;
  changePct: number;
  relStrength: number;
}

export interface SavedIdea extends TradeIdea {
  savedAt: string;
  reportType: ReportType;
}

export interface JournalEntry {
  id: string;
  ticker: string;
  direction: Direction;
  note: string;
  entryPremium: number;
  status: "open" | "win" | "loss" | "scratch";
  createdAt: string;
}

export interface AppAlert {
  id: string;
  level: "info" | "bull" | "bear" | "warn";
  title: string;
  body: string;
  time: string;
}
