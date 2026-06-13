import type { MarketDataProvider } from "./provider";
import type {
  MarketSnapshot,
  Quote,
  OptionContract,
  IndexQuote,
  MacroQuote,
  SectorPerf,
  NewsItem,
  AnalystAction,
  EarningsEvent,
  OptionsFlowItem,
  NewsKind,
  NewsImpact,
} from "../types";
import { UNIVERSE, SECTOR_ETF, INDEX_SYMBOLS, MACRO_PROXIES } from "./universe";

// ============================================================================
// FinnhubProvider — live US market data via the Finnhub free tier.
//
// LIVE from Finnhub:   quotes (price/%/H/L/prevClose), 52w range, beta, price
//                      returns, company + market news, earnings calendar,
//                      analyst recommendation trends.
// DERIVED from live:   technicals (VWAP/MA-stack/RSI/MACD proxies from live
//                      price + returns), news sentiment (keyword model).
// SYNTHESIZED:         options chains, IV / IV-rank, options flow — Finnhub's
//                      free tier has no options data. These are modeled from
//                      the live spot + a volatility estimate and clearly
//                      labeled. Swap in Polygon/Tradier for real chains.
//
// Runs in Node (the scan runner / GitHub Action). The API key is read from
// FINNHUB_API_KEY and never shipped to the browser.
// ============================================================================

const BASE = "https://finnhub.io/api/v1";

function envKey(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
  return env?.FINNHUB_API_KEY;
}

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

interface FinnhubQuote {
  c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number;
}

export class FinnhubProvider implements MarketDataProvider {
  readonly id = "finnhub";
  private gap: number;
  private token: string;

  // gapMs throttles requests (free tier ~30 req/s, 60/min). A key may be passed
  // explicitly (browser / client-side live mode) or read from FINNHUB_API_KEY
  // (Node / GitHub Action).
  constructor(opts: { gapMs?: number; apiKey?: string } = {}) {
    this.gap = opts.gapMs ?? 240;
    const k = opts.apiKey ?? envKey();
    if (!k) throw new Error("No Finnhub API key (pass apiKey or set FINNHUB_API_KEY)");
    this.token = k;
  }

  private async get<T>(path: string, attempt = 0): Promise<T> {
    await sleep(this.gap);
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}token=${this.token}`;
    const res = await fetch(url);
    // Back off and retry on rate-limit (free tier is 60/min).
    if (res.status === 429 && attempt < 2) {
      await sleep(2000);
      return this.get<T>(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`Finnhub ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  private async quote(symbol: string): Promise<FinnhubQuote | null> {
    try {
      const q = await this.get<FinnhubQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`);
      return q && q.c ? q : null;
    } catch {
      return null;
    }
  }

  private async metric(symbol: string): Promise<Record<string, number>> {
    try {
      const m = await this.get<{ metric?: Record<string, number> }>(
        `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`
      );
      return m.metric ?? {};
    } catch {
      return {};
    }
  }

  async getSnapshot(session: "morning" | "evening"): Promise<MarketSnapshot> {
    const asOf = new Date().toISOString();

    // --- Indices -----------------------------------------------------------
    const indices: IndexQuote[] = [];
    for (const ix of INDEX_SYMBOLS) {
      const q = await this.quote(ix.symbol);
      if (q)
        indices.push({
          symbol: ix.symbol,
          name: ix.name,
          price: round(q.c),
          changePct: round(q.dp),
          futuresChangePct: session === "morning" ? round(q.dp) : undefined,
        });
    }
    const spyMetric = await this.metric("SPY");
    const spy13w = num(spyMetric["13WeekPriceReturnDaily"], 0);

    // --- Macro proxies -----------------------------------------------------
    const macro: MacroQuote[] = [];
    for (const m of MACRO_PROXIES) {
      const q = await this.quote(m.symbol);
      if (q) {
        const chg = m.invert ? -q.dp : q.dp; // TLT up => yields down
        macro.push({
          symbol: m.display,
          name: m.name,
          value: round(q.c),
          changePct: round(chg),
          proxyOf: m.symbol, // value is the ETF price, not the real index level
        });
      }
    }

    // --- VIX (proxy via VIXY direction; level best-effort) -----------------
    let vix = 15;
    let vixChangePct = 0;
    const vixDirect = await this.quote("^VIX");
    if (vixDirect) {
      vix = round(vixDirect.c);
      vixChangePct = round(vixDirect.dp);
    } else {
      const vixy = await this.quote("VIXY");
      if (vixy) {
        vixChangePct = round(vixy.dp);
        vix = round(clamp(15 + vixy.dp * 0.5, 10, 45));
      }
    }

    // Sector performance is derived from the universe constituents below
    // (saves 7 calls to stay under the 60/min free-tier limit).
    const sectorChg: Record<string, number> = {};

    // --- Universe quotes + metrics -> Quote ---------------------------------
    const quotes: Quote[] = [];
    const optionChains: Record<string, OptionContract[]> = {};
    for (const u of UNIVERSE) {
      const q = await this.quote(u.ticker);
      if (!q) continue;
      const m = await this.metric(u.ticker);
      const quote = buildQuote(u, q, m, spy13w);
      quotes.push(quote);
      optionChains[u.ticker] = synthesizeChain(quote);
    }

    // --- News (market + a few company headlines) ----------------------------
    const news = await this.fetchNews();

    // --- Earnings calendar (today .. +14d) ----------------------------------
    const earnings = await this.fetchEarnings(quotes);

    // --- Analyst recommendation trends -> actions ---------------------------
    const analyst = await this.fetchAnalyst(quotes.slice(0, 6));

    // --- Sectors -----------------------------------------------------------
    const sectors = buildSectors(quotes, sectorChg);

    // --- Options flow (synthesized from price/vol) --------------------------
    const flow = synthesizeFlow(quotes, news);

    // --- Breadth (from the universe as a sample) ----------------------------
    const advancers = quotes.filter((x) => x.changePct >= 0).length;
    const decliners = quotes.length - advancers;

    return {
      asOf,
      indices,
      macro,
      quotes,
      sectors,
      news,
      analyst,
      earnings,
      flow,
      optionChains,
      vix,
      vixChangePct,
      // scale the sampled breadth toward a market-like count
      advancers: Math.round((advancers / Math.max(1, quotes.length)) * 503),
      decliners: Math.round((decliners / Math.max(1, quotes.length)) * 503),
    };
  }

  async getOptionChain(ticker: string): Promise<OptionContract[]> {
    const q = await this.quote(ticker);
    if (!q) return [];
    const u = UNIVERSE.find((x) => x.ticker === ticker) ?? {
      ticker,
      name: ticker,
      sector: "Technology",
    };
    const m = await this.metric(ticker);
    return synthesizeChain(buildQuote(u, q, m, 0));
  }

  // ------------------------------------------------------------------ news
  private async fetchNews(): Promise<NewsItem[]> {
    const out: NewsItem[] = [];
    try {
      const market = await this.get<RawNews[]>(`/news?category=general`);
      for (const n of market.slice(0, 6)) out.push(toNewsItem(n));
    } catch {
      /* ignore */
    }
    // a few high-interest company headlines
    const from = isoDate(new Date(Date.now() - 2 * 86400000));
    const to = isoDate(new Date());
    for (const t of ["NVDA", "TSLA", "AAPL"]) {
      try {
        const arr = await this.get<RawNews[]>(
          `/company-news?symbol=${t}&from=${from}&to=${to}`
        );
        if (arr[0]) out.push(toNewsItem(arr[0], t));
      } catch {
        /* ignore */
      }
    }
    return dedupeNews(out).slice(0, 12);
  }

  // -------------------------------------------------------------- earnings
  private async fetchEarnings(quotes: Quote[]): Promise<EarningsEvent[]> {
    const from = isoDate(new Date());
    const to = isoDate(new Date(Date.now() + 14 * 86400000));
    try {
      const data = await this.get<{ earningsCalendar?: RawEarnings[] }>(
        `/calendar/earnings?from=${from}&to=${to}`
      );
      const cal = data.earningsCalendar ?? [];
      const watched = new Set(UNIVERSE.map((u) => u.ticker));
      const rows = cal
        .filter((e) => watched.has(e.symbol))
        .slice(0, 6)
        .map((e) => {
          const q = quotes.find((x) => x.ticker === e.symbol);
          const iv = q?.iv ?? 0.4;
          const impliedMove = round(iv * Math.sqrt(7 / 365) * 100 * 1.3, 1);
          return {
            ticker: e.symbol,
            name: UNIVERSE.find((u) => u.ticker === e.symbol)?.name ?? e.symbol,
            date: e.date,
            time: (e.hour === "bmo" ? "bmo" : e.hour === "amc" ? "amc" : "during") as
              | "bmo"
              | "amc"
              | "during",
            epsEstimate: num(e.epsEstimate, 0),
            epsActual: e.epsActual != null ? num(e.epsActual, 0) : undefined,
            revEstimate: num(e.revenueEstimate, 0) / 1e6,
            revActual: e.revenueActual != null ? num(e.revenueActual, 0) / 1e6 : undefined,
            impliedMovePct: impliedMove,
            histAvgMovePct: round(impliedMove * 0.85, 1),
            ivRank: q?.ivRank ?? 45,
          } as EarningsEvent;
        });
      return rows;
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------- analyst
  private async fetchAnalyst(quotes: Quote[]): Promise<AnalystAction[]> {
    const out: AnalystAction[] = [];
    for (const q of quotes) {
      try {
        const recs = await this.get<RawRec[]>(`/stock/recommendation?symbol=${q.ticker}`);
        if (recs.length < 2) continue;
        const [cur, prev] = recs;
        const curBull = cur.strongBuy + cur.buy - cur.sell - cur.strongSell;
        const prevBull = prev.strongBuy + prev.buy - prev.sell - prev.strongSell;
        const delta = curBull - prevBull;
        const rating = curBull > 4 ? "Overweight" : curBull > 0 ? "Buy" : curBull > -3 ? "Hold" : "Underweight";
        out.push({
          id: `rec-${q.ticker}`,
          ticker: q.ticker,
          firm: "Street consensus",
          action: delta > 1 ? "upgrade" : delta < -1 ? "downgrade" : "reiterate",
          toRating: rating,
          time: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (live -> Quote, synthesis)
// ---------------------------------------------------------------------------
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function buildQuote(
  u: { ticker: string; name: string; sector: string },
  q: FinnhubQuote,
  m: Record<string, number>,
  spy13w: number
): Quote {
  const price = round(q.c);
  const prevClose = round(q.pc || q.c);
  const changePct = round(q.dp ?? ((price - prevClose) / prevClose) * 100);

  const high52 = round(num(m["52WeekHigh"], price * 1.3));
  const low52 = round(num(m["52WeekLow"], price * 0.7));
  const beta = round(num(m["beta"], 1.1), 2);
  const r5 = num(m["5DayPriceReturnDaily"], changePct);
  const r13w = num(m["13WeekPriceReturnDaily"], 0);
  const r26w = num(m["26WeekPriceReturnDaily"], 0);
  const avgVolM = num(m["10DayAverageTradingVolume"], 5); // millions

  // --- derived technicals (momentum proxies from live returns) -----------
  const sma20 = round(price / (1 + (r5 / 100) * 0.6));
  const sma50 = round(price / (1 + (r13w / 100) * 0.4));
  const sma200 = round(low52 + (high52 - low52) * 0.45);
  const vwap = round((q.h + q.l + q.c) / 3); // typical-price proxy
  const rsi = round(clamp(50 + r5 * 2.4 + changePct * 1.2, 6, 94), 1);
  const macdHist = round((r5 - r13w / 5) * 0.12, 3);
  const relStrength = round(clamp((r13w - spy13w) * 1.4, -100, 100), 0);

  const dayHigh = round(Math.max(q.h, price));
  const dayLow = round(Math.min(q.l, price));
  const support = round(Math.min(dayLow, price * 0.97));
  const resistance = round(Math.max(dayHigh, price * 1.025));

  // --- estimated volatility (no live IV on free tier) ---------------------
  const realizedProxy = Math.abs(r5) / 5 + Math.abs(changePct);
  const iv = round(clamp(0.18 + beta * 0.11 + realizedProxy * 0.015, 0.12, 1.1), 2);
  const ivRank = Math.round(clamp(25 + (iv - 0.25) * 120, 5, 95));
  const hv = round(iv * 0.8, 2);

  const avgVolume = Math.round(avgVolM * 1e6);
  const relVol = 1 + Math.abs(changePct) * 0.12;

  return {
    ticker: u.ticker,
    name: u.name,
    sector: u.sector,
    price,
    prevClose,
    changePct,
    premarketChangePct: undefined,
    volume: Math.round(avgVolume * relVol),
    avgVolume,
    marketCap: Math.round(num(m["marketCapitalization"], 0) * 1e6) || undefined,
    vwap,
    sma20,
    sma50,
    sma200,
    rsi,
    macdHist,
    high52,
    low52,
    dayHigh,
    dayLow,
    prevHigh: round(prevClose * 1.008),
    prevLow: round(prevClose * 0.992),
    support,
    resistance,
    iv,
    ivRank,
    hv,
    relStrength,
    beta,
  };
}

// Black-Scholes-lite synthesized chain (same model as the mock provider).
function synthesizeChain(q: Quote): OptionContract[] {
  const chain: OptionContract[] = [];
  const now = Date.now();
  const fridays = [1, 3, 6].map((w) => {
    const d = new Date();
    const day = d.getDay();
    const add = ((5 - day + 7) % 7) + w * 7;
    d.setDate(d.getDate() + add);
    return d.toISOString().slice(0, 10);
  });
  const spot = q.price;
  for (const expiry of fridays) {
    const dte = Math.max(1, Math.round((new Date(expiry).getTime() - now) / 86400000));
    const t = dte / 365;
    const sigT = q.iv * Math.sqrt(t);
    const step = spot < 60 ? 2.5 : spot < 200 ? 5 : spot < 500 ? 10 : 25;
    const base = Math.round(spot / step) * step;
    for (let k = -4; k <= 4; k++) {
      const strike = round(base + k * step);
      if (strike <= 0) continue;
      for (const type of ["call", "put"] as const) {
        const moneyness = (spot - strike) / (spot * sigT || 1);
        const callDelta = 1 / (1 + Math.exp(-1.6 * moneyness));
        const delta = type === "call" ? callDelta : callDelta - 1;
        const atmDist = Math.abs(strike - spot) / spot;
        const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
        const timeVal = spot * sigT * 0.4 * Math.exp(-6 * atmDist * atmDist);
        const mid = round(Math.max(0.03, intrinsic + timeVal));
        const spreadPct = 0.02 + atmDist * 0.25 + (q.iv > 0.6 ? 0.04 : 0);
        const half = round((mid * spreadPct) / 2 + 0.02);
        const liq = Math.exp(-10 * atmDist * atmDist);
        const oi = Math.round((200 + liq * 18000) * (q.ivRank / 50 + 0.5));
        chain.push({
          ticker: q.ticker,
          type,
          strike,
          expiry,
          bid: round(Math.max(0.01, mid - half)),
          ask: round(mid + half),
          last: mid,
          volume: Math.round(oi * (0.15 + liq * 0.6)),
          openInterest: oi,
          iv: round(q.iv * (1 + atmDist * 0.6), 3),
          delta: round(delta, 3),
          gamma: round((liq * 0.06) / (spot * sigT || 1), 5),
          theta: round(-(timeVal / Math.max(dte, 1)) * 1.1, 3),
          vega: round(spot * Math.sqrt(t) * 0.4 * liq * 0.01, 3),
        });
      }
    }
  }
  return chain;
}

function synthesizeFlow(quotes: Quote[], news: NewsItem[]): OptionsFlowItem[] {
  const flow: OptionsFlowItem[] = [];
  const ranked = [...quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 9);
  ranked.forEach((q, i) => {
    const bullish = q.changePct >= 0;
    const strike = bullish ? round(q.price * 1.04, 0) : round(q.price * 0.96, 0);
    const size = Math.round(500 + Math.abs(q.changePct) * 900 + Math.random() * 1500);
    const d = new Date();
    d.setMinutes(d.getMinutes() - i * 6);
    flow.push({
      id: `flow-${q.ticker}-${i}`,
      ticker: q.ticker,
      type: bullish ? "call" : "put",
      strike,
      expiry: nextFriday(2),
      premium: Math.round(size * q.price * 0.02 * 100),
      size,
      spotRef: q.price,
      sentiment: bullish ? "bullish" : "bearish",
      kind: i % 3 === 0 ? "sweep" : i % 3 === 1 ? "block" : "split",
      aggressor: bullish ? "ask" : "bid",
      time: d.toISOString(),
    });
  });
  return flow.sort((a, b) => b.premium - a.premium);
}

function nextFriday(weeks: number) {
  const d = new Date();
  const day = d.getDay();
  const add = ((5 - day + 7) % 7) + weeks * 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function buildSectors(quotes: Quote[], sectorChg: Record<string, number>): SectorPerf[] {
  const seen = new Set<string>();
  const out: SectorPerf[] = [];
  for (const q of quotes) {
    if (seen.has(q.sector)) continue;
    seen.add(q.sector);
    const etf = SECTOR_ETF[q.sector] ?? "ETF";
    const changePct = round(sectorChg[etf] ?? avgSectorChange(quotes, q.sector), 2);
    const relStrength = round(changePct - 0.3, 2);
    out.push({
      sector: q.sector,
      etf,
      changePct,
      relStrength,
      rotation:
        relStrength > 0.6 ? "leading" : relStrength > 0 ? "improving" : relStrength > -0.6 ? "weakening" : "lagging",
    });
  }
  return out.sort((a, b) => b.changePct - a.changePct);
}
function avgSectorChange(quotes: Quote[], sector: string) {
  const xs = quotes.filter((q) => q.sector === sector);
  return xs.reduce((s, q) => s + q.changePct, 0) / Math.max(1, xs.length);
}

// ---- news typing + keyword sentiment --------------------------------------
interface RawNews {
  category?: string;
  headline: string;
  source: string;
  summary: string;
  datetime: number;
  related?: string;
  url?: string;
}
interface RawEarnings {
  symbol: string;
  date: string;
  hour?: string;
  epsEstimate?: number;
  epsActual?: number;
  revenueEstimate?: number;
  revenueActual?: number;
}
interface RawRec {
  buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string;
}

const BULL_WORDS = ["beat", "surge", "soar", "jump", "rally", "upgrade", "raises", "record", "growth", "approval", "wins", "tops", "strong", "bullish", "outperform", "expands", "partnership"];
const BEAR_WORDS = ["miss", "plunge", "fall", "drop", "downgrade", "cuts", "lawsuit", "probe", "warning", "weak", "slump", "recall", "halt", "bearish", "underperform", "layoffs", "investigation", "decline"];

function scoreHeadline(text: string): { score: number; kind: NewsKind; impact: NewsImpact } {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of BULL_WORDS) if (t.includes(w)) s += 1;
  for (const w of BEAR_WORDS) if (t.includes(w)) s -= 1;
  const macro = /fed|cpi|inflation|jobs|gdp|yield|rate|economy|treasury|fomc/.test(t);
  const score = clamp(s / 3, -1, 1);
  const impact: NewsImpact = Math.abs(s) >= 2 || macro ? "high" : Math.abs(s) === 1 ? "medium" : "low";
  const kind: NewsKind = macro ? "macro" : score > 0.15 ? "bullish_catalyst" : score < -0.15 ? "bearish_catalyst" : "neutral";
  return { score: round(score, 2), kind, impact };
}

function toNewsItem(n: RawNews, ticker?: string): NewsItem {
  const { score, kind, impact } = scoreHeadline(n.headline + " " + (n.summary ?? ""));
  return {
    id: `${n.datetime}-${(n.headline || "").slice(0, 16)}`,
    ticker: ticker ?? (n.related ? n.related.split(",")[0] : undefined),
    headline: n.headline,
    source: n.source,
    time: new Date(n.datetime * 1000).toISOString(),
    summary: (n.summary || "").slice(0, 220),
    kind,
    impact,
    sentimentScore: score,
  };
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    const key = n.headline.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
