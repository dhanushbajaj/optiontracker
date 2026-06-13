import { useEffect, useMemo, useState } from "react";
import { Card, Chip, MiniBar } from "./ui";
import { fmtDateShort, colorFor } from "../lib/format";
import type { Direction, RiskLevel } from "../types";

// ============================================================================
// Performance page — analytics over the recommendation ledger (history.json,
// committed by the scheduled scan + backfilled by the outcome tracker). Shows
// win rate, average P/L, an equity curve, and — most importantly — whether the
// conviction score actually predicts outcomes (calibration by bucket).
//
// P/L values are the directional, leverage-adjusted % returns recorded by
// scripts/trackOutcomes.ts at the 1d / 3d / 1w horizons.
// ============================================================================

interface LedgerEntry {
  id: string;
  generatedAt: string;
  session: string;
  ticker: string;
  direction: Direction;
  optionType: "call" | "put";
  strike: number;
  conviction: number;
  riskLevel: RiskLevel;
  dataMode?: string;
  outcome: { d1: number | null; d3: number | null; w1: number | null; expiry: number | null };
}

// Clamp to option reality (max loss 100% of premium; cap upside) so any
// legacy/sample outcomes can't render absurd values.
const clampPnl = (n: number) => Math.max(-100, Math.min(300, n));
const horizon = (e: LedgerEntry): number | null => {
  const v = e.outcome?.w1 ?? e.outcome?.d3 ?? e.outcome?.d1 ?? null;
  return v == null ? null : clampPnl(v);
};
const horizonLabel = (e: LedgerEntry): string =>
  e.outcome?.w1 != null ? "1w" : e.outcome?.d3 != null ? "3d" : e.outcome?.d1 != null ? "1d" : "—";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const BUCKETS = [
  { label: "9–10", sub: "A+", min: 9, max: 10.01, tone: "bull" as const },
  { label: "7–8.9", sub: "Good", min: 7, max: 9, tone: "accent" as const },
  { label: "5–6.9", sub: "Watch", min: 5, max: 7, tone: "warn" as const },
  { label: "< 5", sub: "Avoid", min: 0, max: 5, tone: "bear" as const },
];

export function PerformanceView() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/history.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: LedgerEntry[]) => setEntries(Array.isArray(d) ? d : []))
      .catch(() => setError(true));
  }, []);

  const stats = useMemo(() => {
    if (!entries) return null;
    const tracked = entries.filter((e) => horizon(e) !== null);
    const pnls = tracked.map((e) => horizon(e) as number);
    const wins = pnls.filter((p) => p > 0).length;
    const losses = pnls.filter((p) => p < 0).length;

    // chronological cumulative P/L (equity curve)
    const chrono = [...tracked].sort((a, b) => +new Date(a.generatedAt) - +new Date(b.generatedAt));
    let cum = 0;
    const curve = chrono.map((e) => ({ t: e.generatedAt, cum: (cum += horizon(e) as number) }));

    const byBucket = BUCKETS.map((b) => {
      const inB = entries.filter((e) => e.conviction >= b.min && e.conviction < b.max);
      const tr = inB.filter((e) => horizon(e) !== null);
      const ps = tr.map((e) => horizon(e) as number);
      return {
        ...b,
        count: inB.length,
        tracked: tr.length,
        winRate: tr.length ? (ps.filter((p) => p > 0).length / tr.length) * 100 : null,
        avg: tr.length ? mean(ps) : null,
      };
    });

    const dir = (d: Direction) => {
      const tr = tracked.filter((e) => e.direction === d);
      const ps = tr.map((e) => horizon(e) as number);
      return { count: tr.length, winRate: tr.length ? (ps.filter((p) => p > 0).length / tr.length) * 100 : 0, avg: mean(ps) };
    };

    const mockTracked = tracked.filter((e) => e.dataMode !== "live").length;
    return {
      total: entries.length,
      tracked: tracked.length,
      pending: entries.length - tracked.length,
      sampleBased: mockTracked > 0,
      winRate: tracked.length ? (wins / tracked.length) * 100 : 0,
      wins,
      losses,
      avg: mean(pnls),
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
      curve,
      byBucket,
      calls: dir("bullish"),
      puts: dir("bearish"),
      recent: [...entries].sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt)).slice(0, 12),
    };
  }, [entries]);

  if (error)
    return (
      <Card title="Performance" icon={<span>🏆</span>}>
        <div className="text-sm text-ink-dim py-6 text-center">
          No ledger yet. The recommendation history is created by the scheduled scan
          (<code>history.json</code>) and outcomes backfill over 1d / 3d / 1w.
        </div>
      </Card>
    );
  if (!stats) return <Card title="Performance" icon={<span>🏆</span>}><div className="py-6 text-center text-ink-dim text-sm">Loading ledger…</div></Card>;

  return (
    <div className="space-y-4">
      {stats.sampleBased && (
        <div className="rounded-2xl border border-warn/30 bg-warn/5 p-3 text-sm">
          <span className="font-semibold text-warn">⚠ Sample-data backfill.</span>{" "}
          <span className="text-ink-soft">
            These tracked outcomes were generated while scans ran in sample mode. Real performance
            accrues once the scheduled cron runs with your live Finnhub key — new live ideas (shown
            as “pending”) backfill over 1d / 3d / 1w.
          </span>
        </div>
      )}

      {/* Summary */}
      <Card title="Performance Summary" icon={<span>🏆</span>} action={<span className="text-[11px] text-ink-dim">{stats.tracked} tracked · {stats.pending} pending</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Metric label="Ideas logged" value={String(stats.total)} />
          <Metric label="Win rate" value={`${stats.winRate.toFixed(0)}%`} tone={stats.winRate >= 50 ? "bull" : "bear"} />
          <Metric label="Avg return" value={fmtSignedPct(stats.avg)} tone={stats.avg >= 0 ? "bull" : "bear"} />
          <Metric label="W / L" value={`${stats.wins} / ${stats.losses}`} />
          <Metric label="Best" value={fmtSignedPct(stats.best)} tone="bull" />
          <Metric label="Worst" value={fmtSignedPct(stats.worst)} tone="bear" />
        </div>
        <p className="text-[11px] text-ink-dim mt-3">
          Returns are directional, leverage-adjusted estimates at the recommendation's longest tracked
          horizon. Educational tracking — not actual trade results.
        </p>
      </Card>

      {/* Equity curve */}
      {stats.curve.length > 1 && (
        <Card title="Cumulative P/L (equity curve)" icon={<span>📈</span>}>
          <EquityCurve points={stats.curve.map((c) => c.cum)} />
          <div className="flex justify-between text-[10px] text-ink-dim mt-1">
            <span>{fmtDateShort(stats.curve[0].t)}</span>
            <span className={colorFor(stats.curve[stats.curve.length - 1].cum)}>
              cumulative {fmtSignedPct(stats.curve[stats.curve.length - 1].cum)}
            </span>
            <span>{fmtDateShort(stats.curve[stats.curve.length - 1].t)}</span>
          </div>
        </Card>
      )}

      {/* Conviction calibration */}
      <Card title="Conviction Calibration" icon={<span>🎯</span>} action={<span className="text-[10px] text-ink-dim">does the score predict outcomes?</span>}>
        <div className="space-y-3">
          {stats.byBucket.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <div className="w-16 shrink-0">
                <div className="text-sm font-semibold tabular">{b.label}</div>
                <div className="text-[10px] text-ink-dim">{b.sub}</div>
              </div>
              <div className="flex-1">
                {b.winRate == null ? (
                  <div className="text-xs text-ink-dim">no tracked trades</div>
                ) : (
                  <>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-ink-soft">{b.winRate.toFixed(0)}% win</span>
                      <span className={colorFor(b.avg ?? 0)}>{fmtSignedPct(b.avg ?? 0)} avg</span>
                    </div>
                    <MiniBar value={b.winRate} max={100} tone={b.tone} />
                  </>
                )}
              </div>
              <div className="w-14 text-right text-[10px] text-ink-dim shrink-0">
                {b.tracked}/{b.count} trades
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-dim mt-3">
          A well-calibrated model trends higher win-rate and average return as conviction rises.
        </p>
      </Card>

      {/* By direction */}
      <div className="grid sm:grid-cols-2 gap-4">
        <DirCard title="Call ideas (bullish)" tone="bull" d={stats.calls} />
        <DirCard title="Put ideas (bearish)" tone="bear" d={stats.puts} />
      </div>

      {/* Ledger */}
      <Card title="Recommendation Ledger" icon={<span>🗂️</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-ink-dim text-left">
                <th className="font-semibold py-1">Date</th>
                <th className="font-semibold">Ticker</th>
                <th className="font-semibold">Type</th>
                <th className="font-semibold text-right">Conv.</th>
                <th className="font-semibold text-right">Result</th>
                <th className="font-semibold text-right">Horizon</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.map((e) => {
                const r = horizon(e);
                return (
                  <tr key={e.id} className="border-t border-line/60">
                    <td className="py-2 text-xs text-ink-soft">{fmtDateShort(e.generatedAt)}</td>
                    <td className="font-bold">{e.ticker}</td>
                    <td>
                      <Chip tone={e.direction === "bullish" ? "bullish" : "bearish"}>{e.optionType.toUpperCase()}</Chip>
                    </td>
                    <td className="text-right tabular">{e.conviction.toFixed(1)}</td>
                    <td className={`text-right tabular font-semibold ${r == null ? "text-ink-dim" : colorFor(r)}`}>
                      {r == null ? "pending" : fmtSignedPct(r)}
                    </td>
                    <td className="text-right text-xs text-ink-dim">{horizonLabel(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  const c = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink";
  return (
    <div className="rounded-xl bg-bg-soft border border-line p-3">
      <div className="stat-label">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular ${c}`}>{value}</div>
    </div>
  );
}

function DirCard({ title, tone, d }: { title: string; tone: "bull" | "bear"; d: { count: number; winRate: number; avg: number } }) {
  return (
    <Card title={title} icon={<span>{tone === "bull" ? "🟢" : "🔴"}</span>}>
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Trades" value={String(d.count)} />
        <Metric label="Win rate" value={d.count ? `${d.winRate.toFixed(0)}%` : "—"} tone={d.winRate >= 50 ? "bull" : "bear"} />
        <Metric label="Avg" value={d.count ? fmtSignedPct(d.avg) : "—"} tone={d.avg >= 0 ? "bull" : "bear"} />
      </div>
    </Card>
  );
}

function fmtSignedPct(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// Lightweight SVG equity curve (no chart lib).
function EquityCurve({ points }: { points: number[] }) {
  const W = 600;
  const H = 120;
  const pad = 6;
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;
  const stepX = (W - pad * 2) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const x = (i: number) => pad + i * stepX;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = `${path} L ${x(points.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  const end = points[points.length - 1];
  const stroke = end >= 0 ? "#22c55e" : "#ef4444";
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#1f2c3d" strokeWidth="1" strokeDasharray="4 4" />
      <path d={area} fill="url(#eqfill)" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
