// Shared trading universe used by the live (Finnhub) provider and scan runner.
// Keep this list modest so a full scan stays well within free-tier rate limits.

export interface UniverseEntry {
  ticker: string;
  name: string;
  sector: string;
}

export const UNIVERSE: UniverseEntry[] = [
  { ticker: "NVDA", name: "NVIDIA Corp", sector: "Technology" },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "Technology" },
  { ticker: "AAPL", name: "Apple Inc", sector: "Technology" },
  { ticker: "MSFT", name: "Microsoft Corp", sector: "Technology" },
  { ticker: "TSLA", name: "Tesla Inc", sector: "Consumer Discretionary" },
  { ticker: "META", name: "Meta Platforms", sector: "Communication" },
  { ticker: "AMZN", name: "Amazon.com", sector: "Consumer Discretionary" },
  { ticker: "GOOGL", name: "Alphabet Inc", sector: "Communication" },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Financials" },
  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy" },
  { ticker: "COIN", name: "Coinbase Global", sector: "Financials" },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare" },
  { ticker: "BA", name: "Boeing Co", sector: "Industrials" },
  { ticker: "PLTR", name: "Palantir Technologies", sector: "Technology" },
  { ticker: "NFLX", name: "Netflix Inc", sector: "Communication" },
  { ticker: "AVGO", name: "Broadcom Inc", sector: "Technology" },
];

// Sector → SPDR ETF, used for sector relative-strength.
export const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK",
  "Consumer Discretionary": "XLY",
  Communication: "XLC",
  Financials: "XLF",
  Energy: "XLE",
  Healthcare: "XLV",
  Industrials: "XLI",
};

export const INDEX_SYMBOLS = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "DIA", name: "Dow Jones" },
  { symbol: "IWM", name: "Russell 2000" },
];

// Macro read via liquid ETF proxies (free /quote works for all of these).
export const MACRO_PROXIES = [
  { symbol: "TLT", display: "US10Y", name: "10Y Treasury (TLT proxy)", invert: true },
  { symbol: "UUP", display: "DXY", name: "Dollar Index (UUP proxy)", invert: false },
  { symbol: "USO", display: "CL", name: "Crude Oil (USO proxy)", invert: false },
  { symbol: "GLD", display: "GC", name: "Gold (GLD proxy)", invert: false },
  { symbol: "IBIT", display: "BTC", name: "Bitcoin (IBIT proxy)", invert: false },
];
