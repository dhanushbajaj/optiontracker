import type {
  MarketDataProvider,
} from "./provider";
import type {
  MarketSnapshot,
  OptionContract,
  Quote,
  IndexQuote,
  MacroQuote,
  SectorPerf,
  NewsItem,
  AnalystAction,
  EarningsEvent,
  OptionsFlowItem,
} from "../types";

// ----------------------------------------------------------------------------
// Deterministic-ish RNG so a given session renders stable data within a run,
// but morning/evening differ. Seeded by session string.
// ----------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const todayISO = () => new Date().toISOString();
function addDays(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}
function nextFriday(weeksOut: number) {
  const dt = new Date();
  const day = dt.getDay();
  const add = ((5 - day + 7) % 7) + weeksOut * 7;
  dt.setDate(dt.getDate() + add);
  return dt.toISOString().slice(0, 10);
}
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

// ----------------------------------------------------------------------------
// Base universe. Numbers are illustrative but internally consistent.
// ----------------------------------------------------------------------------
interface Seed {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  iv: number;
  ivRank: number;
  beta: number;
  bias: number; // -1..1 baseline directional lean for the day
  earnings?: { inDays: number; time: "bmo" | "amc" };
}

const UNIVERSE: Seed[] = ([
  { ticker: "NVDA", name: "NVIDIA Corp", sector: "Technology", price: 142.3, iv: 0.52, ivRank: 64, beta: 1.7, bias: 0.8 },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "Technology", price: 178.4, iv: 0.55, ivRank: 58, beta: 1.8, bias: 0.6, earnings: { inDays: 9, time: "amc" } },
  { ticker: "AAPL", name: "Apple Inc", sector: "Technology", price: 224.1, iv: 0.28, ivRank: 31, beta: 1.2, bias: 0.2 },
  { ticker: "MSFT", name: "Microsoft Corp", sector: "Technology", price: 438.7, iv: 0.26, ivRank: 28, beta: 1.0, bias: 0.3 },
  { ticker: "TSLA", name: "Tesla Inc", sector: "Consumer Discretionary", price: 251.6, iv: 0.62, ivRank: 71, beta: 2.1, bias: -0.5 },
  { ticker: "META", name: "Meta Platforms", sector: "Communication", price: 564.2, iv: 0.34, ivRank: 42, beta: 1.3, bias: 0.5 },
  { ticker: "AMZN", name: "Amazon.com", sector: "Consumer Discretionary", price: 198.9, iv: 0.31, ivRank: 36, beta: 1.2, bias: 0.3 },
  { ticker: "GOOGL", name: "Alphabet Inc", sector: "Communication", price: 176.8, iv: 0.29, ivRank: 33, beta: 1.1, bias: 0.1 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Financials", price: 218.4, iv: 0.22, ivRank: 24, beta: 1.1, bias: 0.2 },
  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy", price: 118.7, iv: 0.24, ivRank: 38, beta: 0.9, bias: -0.3 },
  { ticker: "META2", name: "placeholder", sector: "", price: 0, iv: 0, ivRank: 0, beta: 0, bias: 0 },
  { ticker: "COIN", name: "Coinbase Global", sector: "Financials", price: 248.3, iv: 0.78, ivRank: 69, beta: 3.1, bias: 0.7 },
  { ticker: "SMCI", name: "Super Micro Computer", sector: "Technology", price: 44.2, iv: 0.85, ivRank: 74, beta: 2.4, bias: -0.6 },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare", price: 812.5, iv: 0.33, ivRank: 45, beta: 0.7, bias: 0.4, earnings: { inDays: 2, time: "bmo" } },
  { ticker: "BA", name: "Boeing Co", sector: "Industrials", price: 178.9, iv: 0.41, ivRank: 52, beta: 1.4, bias: -0.4 },
  { ticker: "PLTR", name: "Palantir Technologies", sector: "Technology", price: 64.8, iv: 0.66, ivRank: 61, beta: 2.0, bias: 0.6 },
  { ticker: "NFLX", name: "Netflix Inc", sector: "Communication", price: 698.2, iv: 0.37, ivRank: 40, beta: 1.2, bias: 0.3, earnings: { inDays: 1, time: "amc" } },
] as Seed[]).filter((s) => s.ticker !== "META2");

function buildQuote(seed: Seed, session: "morning" | "evening"): Quote {
  const rng = mulberry32(hashStr(seed.ticker + session));
  const sessionFactor = session === "evening" ? 1.15 : 0.9;
  const noise = (rng() - 0.5) * 2; // -1..1
  const dayMovePct = round(seed.bias * 2.4 * sessionFactor + noise * 1.1, 2);
  const prevClose = round(seed.price / (1 + dayMovePct / 100), 2);
  const price = seed.price;
  const premarket = session === "morning" ? round(seed.bias * 1.4 + noise * 0.6, 2) : undefined;

  const sma20 = round(price * (1 - seed.bias * 0.02 + (rng() - 0.5) * 0.01), 2);
  const sma50 = round(price * (1 - seed.bias * 0.05 + (rng() - 0.5) * 0.02), 2);
  const sma200 = round(price * (1 - seed.bias * 0.12 + (rng() - 0.5) * 0.05), 2);
  const vwap = round(price * (1 - seed.bias * 0.006), 2);
  const rsi = Math.max(8, Math.min(92, round(52 + seed.bias * 22 + noise * 8, 1)));
  const macdHist = round(seed.bias * 1.2 + noise * 0.4, 3);
  const support = round(price * (1 - 0.03 - rng() * 0.02), 2);
  const resistance = round(price * (1 + 0.025 + rng() * 0.02), 2);
  const avgVolume = Math.round((4 + rng() * 60) * 1e6);
  const relVol = 0.8 + Math.abs(seed.bias) * 1.4 + rng() * 0.6;

  return {
    ticker: seed.ticker,
    name: seed.name,
    sector: seed.sector,
    price,
    prevClose,
    changePct: dayMovePct,
    premarketChangePct: premarket,
    volume: Math.round(avgVolume * relVol),
    avgVolume,
    marketCap: Math.round(price * (5e8 + rng() * 6e9)),
    vwap,
    sma20,
    sma50,
    sma200,
    rsi,
    macdHist,
    high52: round(price * (1.05 + rng() * 0.4), 2),
    low52: round(price * (0.5 + rng() * 0.2), 2),
    dayHigh: round(price * (1 + Math.abs(noise) * 0.01 + 0.004), 2),
    dayLow: round(price * (1 - Math.abs(noise) * 0.01 - 0.004), 2),
    prevHigh: round(prevClose * 1.008, 2),
    prevLow: round(prevClose * 0.992, 2),
    support,
    resistance,
    iv: seed.iv,
    ivRank: seed.ivRank,
    hv: round(seed.iv * (0.7 + rng() * 0.3), 2),
    relStrength: round(seed.bias * 60 + noise * 25, 0),
    beta: seed.beta,
  };
}

// Black-Scholes-lite greeks approximation for realistic-looking chains.
function buildChain(q: Quote): OptionContract[] {
  const chain: OptionContract[] = [];
  const expiries = [nextFriday(1), nextFriday(3), nextFriday(6)];
  const spot = q.price;
  for (const expiry of expiries) {
    const dte = Math.max(
      1,
      Math.round((new Date(expiry).getTime() - Date.now()) / 86400000)
    );
    const t = dte / 365;
    const sigT = q.iv * Math.sqrt(t);
    const step = spot < 60 ? 2.5 : spot < 200 ? 5 : spot < 500 ? 10 : 25;
    const base = Math.round(spot / step) * step;
    for (let k = -4; k <= 4; k++) {
      const strike = round(base + k * step, 2);
      if (strike <= 0) continue;
      for (const type of ["call", "put"] as const) {
        const moneyness = (spot - strike) / (spot * sigT || 1);
        // crude delta via logistic of moneyness
        const callDelta = 1 / (1 + Math.exp(-1.6 * moneyness));
        const delta = type === "call" ? callDelta : callDelta - 1;
        const atmDist = Math.abs(strike - spot) / spot;
        const intrinsic =
          type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
        const timeVal = spot * sigT * 0.4 * Math.exp(-6 * atmDist * atmDist);
        const mid = round(Math.max(0.03, intrinsic + timeVal), 2);
        const spreadPct = 0.02 + atmDist * 0.25 + (q.iv > 0.6 ? 0.04 : 0);
        const half = round((mid * spreadPct) / 2 + 0.02, 2);
        const liquidityCore = Math.exp(-10 * atmDist * atmDist);
        const oi = Math.round((200 + liquidityCore * 18000) * (q.ivRank / 50 + 0.5));
        const vol = Math.round(oi * (0.15 + liquidityCore * 0.6));
        const gamma = round((liquidityCore * 0.06) / (spot * sigT || 1), 5);
        const theta = round(-(timeVal / Math.max(dte, 1)) * 1.1, 3);
        const vega = round(spot * Math.sqrt(t) * 0.4 * liquidityCore * 0.01, 3);
        chain.push({
          ticker: q.ticker,
          type,
          strike,
          expiry,
          bid: round(Math.max(0.01, mid - half), 2),
          ask: round(mid + half, 2),
          last: mid,
          volume: vol,
          openInterest: oi,
          iv: round(q.iv * (1 + atmDist * 0.6), 3),
          delta: round(delta, 3),
          gamma,
          theta,
          vega,
        });
      }
    }
  }
  return chain;
}

function buildNews(session: "morning" | "evening"): NewsItem[] {
  const t = (h: number) => {
    const d = new Date();
    d.setHours(h, Math.floor(Math.random() * 59));
    return d.toISOString();
  };
  const items: NewsItem[] = [
    {
      id: "n1",
      ticker: "NVDA",
      headline: "NVIDIA guides next-quarter revenue above Street on sovereign-AI demand",
      source: "Reuters",
      time: t(6),
      summary:
        "Management cited accelerating data-center orders and called supply 'fully allocated' through next year. Several desks raised estimates.",
      kind: "bullish_catalyst",
      impact: "high",
      sentimentScore: 0.82,
    },
    {
      id: "n2",
      ticker: "TSLA",
      headline: "Tesla deliveries miss as China demand softens; price cuts deepen",
      source: "Bloomberg",
      time: t(7),
      summary:
        "Q deliveries came in below consensus and margin pressure is expected to persist. Two firms trimmed targets overnight.",
      kind: "bearish_catalyst",
      impact: "high",
      sentimentScore: -0.71,
    },
    {
      id: "n3",
      ticker: "LLY",
      headline: "Eli Lilly's oral GLP-1 hits primary endpoint in late-stage trial",
      source: "STAT",
      time: t(6),
      summary:
        "Phase 3 obesity data beat expectations on weight-loss magnitude with a clean safety profile ahead of tomorrow's earnings.",
      kind: "bullish_catalyst",
      impact: "high",
      sentimentScore: 0.68,
    },
    {
      id: "n4",
      headline: "Fed minutes signal patience; officials want 'more good data' before cuts",
      source: "WSJ",
      time: t(5),
      summary:
        "Minutes leaned slightly hawkish but markets still price the next move as a cut. Yields ticked higher across the curve.",
      kind: "macro",
      impact: "high",
      sentimentScore: -0.18,
    },
    {
      id: "n5",
      ticker: "BA",
      headline: "Boeing faces fresh FAA scrutiny over production line inspections",
      source: "CNBC",
      time: t(8),
      summary:
        "Regulators opened a review of fuselage assembly quality. Headline risk elevated into the cash session.",
      kind: "bearish_catalyst",
      impact: "medium",
      sentimentScore: -0.52,
    },
    {
      id: "n6",
      ticker: "COIN",
      headline: "Crypto rallies overnight; Bitcoin reclaims key level as ETF inflows resume",
      source: "CoinDesk",
      time: t(4),
      summary:
        "Risk appetite in digital assets lifted exchange and miner names in premarket. Call flow heavy in COIN.",
      kind: "bullish_catalyst",
      impact: "medium",
      sentimentScore: 0.59,
    },
    {
      id: "n7",
      ticker: "SMCI",
      headline: "Super Micro slips after short-seller questions accounting disclosures",
      source: "Barron's",
      time: t(7),
      summary:
        "A new report raised flags on revenue recognition. Shares indicated lower with elevated put activity.",
      kind: "bearish_catalyst",
      impact: "medium",
      sentimentScore: -0.64,
    },
    {
      id: "n8",
      ticker: "PLTR",
      headline: "Palantir lands expanded government AI contract worth up to $480M",
      source: "Reuters",
      time: t(6),
      summary:
        "Multi-year award expands the company's defense footprint and supports the bull narrative on commercial AI traction.",
      kind: "bullish_catalyst",
      impact: "medium",
      sentimentScore: 0.55,
    },
  ];
  if (session === "evening") {
    items.unshift({
      id: "n0",
      ticker: "NFLX",
      headline: "Netflix tops subscriber and revenue estimates; raises full-year guidance",
      source: "AfterHours",
      time: t(16),
      summary:
        "Strong net adds and ad-tier momentum drove a beat. Shares jumped in the after-hours session; IV likely to compress tomorrow.",
      kind: "bullish_catalyst",
      impact: "high",
      sentimentScore: 0.74,
    });
  }
  return items;
}

function buildAnalyst(): AnalystAction[] {
  const now = todayISO();
  return [
    { id: "a1", ticker: "NVDA", firm: "Morgan Stanley", action: "pt_change", toRating: "Overweight", priceTarget: 175, prevTarget: 160, time: now },
    { id: "a2", ticker: "AMD", firm: "Goldman Sachs", action: "upgrade", fromRating: "Neutral", toRating: "Buy", priceTarget: 205, time: now },
    { id: "a3", ticker: "TSLA", firm: "UBS", action: "downgrade", fromRating: "Neutral", toRating: "Sell", priceTarget: 215, time: now },
    { id: "a4", ticker: "META", firm: "JPMorgan", action: "reiterate", toRating: "Overweight", priceTarget: 640, time: now },
    { id: "a5", ticker: "BA", firm: "Wells Fargo", action: "downgrade", fromRating: "Equal Weight", toRating: "Underweight", priceTarget: 160, time: now },
    { id: "a6", ticker: "PLTR", firm: "Wedbush", action: "pt_change", toRating: "Outperform", priceTarget: 80, prevTarget: 65, time: now },
  ];
}

function buildEarnings(): EarningsEvent[] {
  return [
    { ticker: "NFLX", name: "Netflix Inc", date: addDays(0), time: "amc", epsEstimate: 5.12, epsActual: 5.4, revEstimate: 9830, revActual: 9920, impliedMovePct: 8.1, histAvgMovePct: 7.3, ivRank: 40, guidance: "raised" },
    { ticker: "LLY", name: "Eli Lilly", date: addDays(2), time: "bmo", epsEstimate: 4.18, revEstimate: 12650, impliedMovePct: 6.4, histAvgMovePct: 5.1, ivRank: 45 },
    { ticker: "AMD", name: "Advanced Micro Devices", date: addDays(9), time: "amc", epsEstimate: 0.92, revEstimate: 7420, impliedMovePct: 9.2, histAvgMovePct: 8.4, ivRank: 58 },
    { ticker: "TSLA", name: "Tesla Inc", date: addDays(11), time: "amc", epsEstimate: 0.61, revEstimate: 25300, impliedMovePct: 10.5, histAvgMovePct: 8.9, ivRank: 71 },
  ];
}

function buildFlow(quotes: Quote[]): OptionsFlowItem[] {
  const flow: OptionsFlowItem[] = [];
  const picks: [string, "call" | "put", "bullish" | "bearish"][] = [
    ["NVDA", "call", "bullish"],
    ["AMD", "call", "bullish"],
    ["TSLA", "put", "bearish"],
    ["PLTR", "call", "bullish"],
    ["COIN", "call", "bullish"],
    ["SMCI", "put", "bearish"],
    ["BA", "put", "bearish"],
    ["META", "call", "bullish"],
    ["NFLX", "call", "bullish"],
  ];
  picks.forEach(([tk, type, sent], i) => {
    const q = quotes.find((x) => x.ticker === tk);
    if (!q) return;
    const strike =
      type === "call"
        ? round(q.price * (1.03 + Math.random() * 0.05), 0)
        : round(q.price * (0.97 - Math.random() * 0.05), 0);
    const size = Math.round(500 + Math.random() * 6000);
    const prem = Math.round(size * (q.price * 0.02) * 100);
    const d = new Date();
    d.setMinutes(d.getMinutes() - i * 7);
    flow.push({
      id: "f" + i,
      ticker: tk,
      type,
      strike,
      expiry: nextFriday(2),
      premium: prem,
      size,
      spotRef: q.price,
      sentiment: sent,
      kind: i % 3 === 0 ? "sweep" : i % 3 === 1 ? "block" : "split",
      aggressor: sent === "bullish" ? "ask" : "bid",
      time: d.toISOString(),
    });
  });
  return flow.sort((a, b) => b.premium - a.premium);
}

function buildSectors(quotes: Quote[]): SectorPerf[] {
  const map = new Map<string, { etf: string; sum: number; n: number }>();
  const etfFor: Record<string, string> = {
    Technology: "XLK",
    "Consumer Discretionary": "XLY",
    Communication: "XLC",
    Financials: "XLF",
    Energy: "XLE",
    Healthcare: "XLV",
    Industrials: "XLI",
  };
  for (const q of quotes) {
    if (!q.sector) continue;
    const e = map.get(q.sector) || { etf: etfFor[q.sector] || "ETF", sum: 0, n: 0 };
    e.sum += q.changePct;
    e.n += 1;
    map.set(q.sector, e);
  }
  const sectors: SectorPerf[] = [];
  for (const [sector, v] of map) {
    const changePct = round(v.sum / v.n, 2);
    const relStrength = round(changePct - 0.3, 2);
    sectors.push({
      sector,
      etf: v.etf,
      changePct,
      relStrength,
      rotation:
        relStrength > 0.6
          ? "leading"
          : relStrength > 0
          ? "improving"
          : relStrength > -0.6
          ? "weakening"
          : "lagging",
    });
  }
  return sectors.sort((a, b) => b.changePct - a.changePct);
}

export class MockProvider implements MarketDataProvider {
  readonly id = "mock";

  async getSnapshot(session: "morning" | "evening"): Promise<MarketSnapshot> {
    const quotes = UNIVERSE.map((s) => buildQuote(s, session));
    const optionChains: Record<string, OptionContract[]> = {};
    for (const q of quotes) optionChains[q.ticker] = buildChain(q);

    const sessionLean = session === "evening" ? 0.35 : 0.15;
    const indices: IndexQuote[] = [
      { symbol: "SPY", name: "S&P 500", price: 596.4, changePct: round(0.4 + sessionLean, 2), futuresChangePct: session === "morning" ? 0.32 : undefined },
      { symbol: "QQQ", name: "Nasdaq 100", price: 521.8, changePct: round(0.7 + sessionLean, 2), futuresChangePct: session === "morning" ? 0.55 : undefined },
      { symbol: "DIA", name: "Dow Jones", price: 432.1, changePct: round(0.1 + sessionLean * 0.5, 2), futuresChangePct: session === "morning" ? 0.08 : undefined },
      { symbol: "IWM", name: "Russell 2000", price: 224.3, changePct: round(-0.2 + sessionLean, 2), futuresChangePct: session === "morning" ? -0.15 : undefined },
    ];
    const macro: MacroQuote[] = [
      { symbol: "US10Y", name: "10Y Treasury", value: 4.28, changePct: 0.6, unit: "%" },
      { symbol: "DXY", name: "Dollar Index", value: 104.6, changePct: 0.15 },
      { symbol: "CL", name: "Crude Oil", value: 78.4, changePct: -0.9, unit: "$" },
      { symbol: "GC", name: "Gold", value: 2412, changePct: 0.4, unit: "$" },
      { symbol: "BTC", name: "Bitcoin", value: 68240, changePct: 2.3, unit: "$" },
    ];

    return {
      asOf: todayISO(),
      indices,
      macro,
      quotes,
      sectors: buildSectors(quotes),
      news: buildNews(session),
      analyst: buildAnalyst(),
      earnings: buildEarnings(),
      flow: buildFlow(quotes),
      optionChains,
      vix: round(14.2 - sessionLean * 2 + Math.random(), 2),
      vixChangePct: round(-3 - sessionLean * 2, 2),
      advancers: Math.round(300 + sessionLean * 120 + Math.random() * 40),
      decliners: Math.round(200 - sessionLean * 80 + Math.random() * 40),
    };
  }

  async getOptionChain(ticker: string): Promise<OptionContract[]> {
    const snap = await this.getSnapshot("morning");
    return snap.optionChains[ticker] ?? [];
  }
}
