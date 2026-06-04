import type { OptionContract, Quote, Direction } from "../types";

// ----------------------------------------------------------------------------
// Options selection engine. Given a ticker view and a direction, it picks the
// single best-balanced contract: liquid, slightly OTM, enough time to expiry,
// reasonable spread. Also scores liquidity 0-10 and computes trade levels.
// ----------------------------------------------------------------------------

export interface LiquidityRead {
  score: number; // 0-10
  spreadPct: number;
  notes: string[];
  tradeable: boolean;
}

export function scoreLiquidity(c: OptionContract): LiquidityRead {
  const mid = (c.bid + c.ask) / 2 || c.last;
  const spreadPct = mid > 0 ? (c.ask - c.bid) / mid : 1;
  const notes: string[] = [];
  let score = 10;

  if (spreadPct > 0.12) {
    score -= 4;
    notes.push(`Wide spread (${(spreadPct * 100).toFixed(0)}%)`);
  } else if (spreadPct > 0.06) {
    score -= 1.5;
    notes.push(`Moderate spread (${(spreadPct * 100).toFixed(0)}%)`);
  } else {
    notes.push("Tight spread");
  }

  if (c.openInterest < 250) {
    score -= 4;
    notes.push("Low open interest");
  } else if (c.openInterest < 1000) {
    score -= 1.5;
    notes.push("Modest open interest");
  } else {
    notes.push(`Deep OI (${c.openInterest.toLocaleString()})`);
  }

  if (c.volume < 100) {
    score -= 3;
    notes.push("Thin volume today");
  } else {
    notes.push(`Active (${c.volume.toLocaleString()} vol)`);
  }

  score = Math.max(0, Math.min(10, score));
  return {
    score: Number(score.toFixed(1)),
    spreadPct,
    notes,
    tradeable: score >= 5 && spreadPct <= 0.15,
  };
}

export interface SelectedOption {
  contract: OptionContract;
  liquidity: LiquidityRead;
  entryLow: number;
  entryHigh: number;
  targetLow: number;
  targetHigh: number;
  stopPremium: number;
  probProfit: number;
  expectedMovePct: number;
  maxLossPerContract: number;
}

/**
 * Pick the best contract for a directional thesis.
 * Strategy: ~0.35–0.45 delta (slightly OTM), 2–6 weeks out, best liquidity.
 */
export function selectContract(
  q: Quote,
  chain: OptionContract[],
  direction: Direction
): SelectedOption | null {
  const type = direction === "bearish" ? "put" : "call";
  const candidates = chain.filter((c) => c.type === type);
  if (!candidates.length) return null;

  const now = Date.now();
  const scored = candidates
    .map((c) => {
      const dte = (new Date(c.expiry).getTime() - now) / 86400000;
      const liq = scoreLiquidity(c);
      const targetDelta = 0.4;
      const deltaFit = 1 - Math.min(1, Math.abs(Math.abs(c.delta) - targetDelta) / 0.4);
      const dteFit =
        dte < 7 ? 0.3 : dte > 60 ? 0.5 : 1 - Math.abs(dte - 28) / 60;
      const fit = liq.score / 10 * 0.5 + deltaFit * 0.3 + dteFit * 0.2;
      return { c, liq, dte, fit };
    })
    .filter((x) => x.liq.tradeable)
    .sort((a, b) => b.fit - a.fit);

  const best = scored[0];
  if (!best) return null;

  const c = best.c;
  const mid = (c.bid + c.ask) / 2 || c.last;
  const dte = best.dte;

  // Expected move from IV over the holding window (~half to expiry).
  const t = Math.max(dte, 1) / 365;
  const expectedMovePct = q.iv * Math.sqrt(t) * 100;

  // Probability of profit ≈ rough delta-based proxy for finishing ITM, nudged
  // by trend alignment. (Real engine would use full BS / MC.)
  let pop = Math.min(0.85, Math.max(0.2, Math.abs(c.delta)));
  pop = Math.min(0.85, pop + 0.05);

  const entryLow = Number((mid * 0.95).toFixed(2));
  const entryHigh = Number((mid * 1.05).toFixed(2));
  const targetLow = Number((mid * 1.5).toFixed(2));
  const targetHigh = Number((mid * 1.9).toFixed(2));
  const stopPremium = Number((mid * 0.6).toFixed(2));
  const maxLossPerContract = Number((mid * 100).toFixed(0));

  return {
    contract: c,
    liquidity: best.liq,
    entryLow,
    entryHigh,
    targetLow,
    targetHigh,
    stopPremium,
    probProfit: Number(pop.toFixed(2)),
    expectedMovePct: Number(expectedMovePct.toFixed(1)),
    maxLossPerContract,
  };
}
