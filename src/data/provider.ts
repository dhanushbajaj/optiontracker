import type { MarketSnapshot, OptionContract } from "../types";

// ============================================================================
// MarketDataProvider — the single seam between Option Oracle and the outside
// world. Implement this interface against Polygon, Tradier, Finnhub, Alpaca,
// FMP, etc. and register it in `getProvider()`. Everything else in the app is
// provider-agnostic.
// ============================================================================

export interface MarketDataProvider {
  readonly id: string;
  /** Pull a full market snapshot for a given moment ("morning" | "evening"). */
  getSnapshot(session: "morning" | "evening"): Promise<MarketSnapshot>;
  /** Options chain for a ticker (used by the recommendation engine). */
  getOptionChain(ticker: string): Promise<OptionContract[]>;
}

let active: MarketDataProvider | null = null;

export function registerProvider(p: MarketDataProvider) {
  active = p;
}

export function getProvider(): MarketDataProvider {
  if (!active) {
    throw new Error(
      "No MarketDataProvider registered. Call registerProvider() at startup."
    );
  }
  return active;
}
