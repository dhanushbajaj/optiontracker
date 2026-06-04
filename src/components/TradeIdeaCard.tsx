import { useState } from "react";
import type { TradeIdea } from "../types";
import { Chip, ConvictionDial, RiskBadge, MiniBar } from "./ui";
import { fmtUsd, fmtDate, fmtPct } from "../lib/format";
import { WEIGHTS } from "../engines/conviction";
import { useApp } from "../store";

const FACTOR_LABELS: { key: keyof typeof WEIGHTS; label: string }[] = [
  { key: "catalyst", label: "Catalyst" },
  { key: "technical", label: "Technical" },
  { key: "liquidity", label: "Liquidity" },
  { key: "marketAlignment", label: "Market align" },
  { key: "sectorStrength", label: "Sector" },
  { key: "riskReward", label: "Risk/reward" },
  { key: "newsQuality", label: "News quality" },
  { key: "volatility", label: "Volatility" },
];

export function TradeIdeaCard({
  idea,
  featured = false,
}: {
  idea: TradeIdea;
  featured?: boolean;
}) {
  const [open, setOpen] = useState(featured);
  const { saved, saveIdea, removeSaved } = useApp();
  const isSaved = saved.some((s) => s.id === idea.id);
  const bull = idea.direction === "bullish";
  const tone = bull ? "bullish" : "bearish";
  const accentBorder = bull ? "border-bull/30" : "border-bear/30";

  const contractLabel = `${idea.ticker} ${fmtUsd(idea.contract.strike, 0)} ${idea.optionType.toUpperCase()}`;

  return (
    <div
      className={`card overflow-hidden ${featured ? `border-2 ${accentBorder} shadow-glow` : ""}`}
    >
      {/* Header strip */}
      <div
        className={`px-4 sm:px-5 py-3 flex items-center justify-between gap-3 ${
          bull ? "bg-bull/10" : "bg-bear/10"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ConvictionDial value={idea.conviction} size={featured ? 64 : 52} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold">{idea.ticker}</span>
              <Chip tone={tone}>
                {bull ? "Bullish" : "Bearish"} · {idea.optionType.toUpperCase()}
              </Chip>
              {idea.earningsRisk && <Chip tone="warn">⚠ Earnings risk</Chip>}
            </div>
            <div className="text-xs text-ink-soft truncate">{idea.name}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <RiskBadge level={idea.riskLevel} />
          <div className="text-[11px] text-ink-dim mt-1 tabular">
            Spot {fmtUsd(idea.spotAtRec)}
          </div>
        </div>
      </div>

      {/* Contract + levels */}
      <div className="card-pad space-y-4">
        <div className="rounded-xl bg-bg-soft border border-line p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="stat-label">Suggested contract</div>
              <div className="font-bold text-base mt-0.5">{contractLabel}</div>
              <div className="text-xs text-ink-soft">Expires {fmtDate(idea.contract.expiry)}</div>
            </div>
            <div className="text-right text-xs text-ink-soft">
              <div>Δ {idea.contract.delta.toFixed(2)} · IV {(idea.contract.iv * 100).toFixed(0)}%</div>
              <div>OI {idea.contract.openInterest.toLocaleString()} · Vol {idea.contract.volume.toLocaleString()}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-line">
            <LevelStat label="Entry" value={`${fmtUsd(idea.entryLow)}–${fmtUsd(idea.entryHigh)}`} />
            <LevelStat label="Target" value={`${fmtUsd(idea.targetLow)}–${fmtUsd(idea.targetHigh)}`} tone="bull" />
            <LevelStat label="Stop (prem)" value={fmtUsd(idea.stopPremium)} tone="bear" />
            <LevelStat label="Stock stop" value={fmtUsd(idea.stopStock)} tone="bear" />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-line text-xs">
            <div>
              <span className="text-ink-dim">Prob. profit </span>
              <span className="tabular font-semibold">{(idea.probProfit * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-ink-dim">Exp. move </span>
              <span className="tabular font-semibold">±{idea.expectedMovePct}%</span>
            </div>
            <div>
              <span className="text-ink-dim">Max loss </span>
              <span className="tabular font-semibold">{fmtUsd(idea.maxLossPerContract, 0)}/contract</span>
            </div>
          </div>
        </div>

        {/* Thesis */}
        <p className="text-sm text-ink-soft leading-relaxed">{idea.thesis}</p>

        <button
          className="text-xs font-semibold text-accent hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "− Hide full breakdown" : "+ Show full thesis, bull/bear case & score breakdown"}
        </button>

        {open && (
          <div className="space-y-4 animate-slideUp">
            <div className="grid sm:grid-cols-2 gap-3">
              <CaseList title={bull ? "Bull case" : "Bear case (why the put works)"} tone="bull" items={idea.bullCase} />
              <CaseList title="Risks / what could go wrong" tone="bear" items={idea.bearCase} />
            </div>

            {/* Conviction breakdown */}
            <div className="rounded-xl bg-bg-soft border border-line p-3">
              <div className="stat-label mb-2">Conviction breakdown (weighted)</div>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                {FACTOR_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-ink-soft w-24 shrink-0">{label}</span>
                    <div className="flex-1">
                      <MiniBar
                        value={idea.breakdown[key]}
                        tone={idea.breakdown[key] >= 7 ? "bull" : idea.breakdown[key] >= 5 ? "accent" : "warn"}
                      />
                    </div>
                    <span className="text-xs tabular w-8 text-right">{idea.breakdown[key].toFixed(1)}</span>
                    <span className="text-[10px] text-ink-dim w-8 text-right">{(WEIGHTS[key] * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Invalidation + risk mgmt */}
            <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
              <div className="font-semibold text-warn mb-1">Invalidation</div>
              <p className="text-ink-soft">{idea.invalidation}</p>
            </div>
            <div className="rounded-xl border border-line bg-bg-soft p-3 text-sm">
              <div className="font-semibold mb-1">Risk management</div>
              <p className="text-ink-soft">
                High-risk options trade. Suggested size ≤ {idea.suggestedRiskPct}% of portfolio.
                Max loss is the full premium ({fmtUsd(idea.maxLossPerContract, 0)} per contract). Honor the stop.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            className={`btn flex-1 ${isSaved ? "btn-accent" : ""}`}
            onClick={() => (isSaved ? removeSaved(idea.id) : saveIdea(idea))}
          >
            {isSaved ? "★ Saved" : "☆ Save idea"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LevelStat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink";
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`mt-0.5 font-semibold tabular text-sm ${color}`}>{value}</div>
    </div>
  );
}

function CaseList({ title, tone, items }: { title: string; tone: "bull" | "bear"; items: string[] }) {
  const color = tone === "bull" ? "text-bull" : "text-bear";
  const mark = tone === "bull" ? "✓" : "✕";
  return (
    <div>
      <div className={`text-xs font-semibold mb-1.5 ${color}`}>{title}</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-ink-soft flex gap-2">
            <span className={`${color} shrink-0`}>{mark}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
