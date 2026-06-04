import React from "react";
import type { Direction, RiskLevel, SentimentLabel } from "../types";
import { SENTIMENT_META } from "../engines/sentiment";
import { colorFor } from "../lib/format";

export function Chip({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Direction | "warn" | "accent";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    bullish: "bg-bull/15 text-bull",
    bearish: "bg-bear/15 text-bear",
    neutral: "bg-white/5 text-ink-soft",
    warn: "bg-warn/15 text-warn",
    accent: "bg-accent/15 text-accent",
  };
  return <span className={`chip ${tones[tone]} ${className}`}>{children}</span>;
}

export function Delta({ value, suffix = "%", className = "" }: { value: number; suffix?: string; className?: string }) {
  return (
    <span className={`tabular font-semibold ${colorFor(value)} ${className}`}>
      {value > 0 ? "▲ " : value < 0 ? "▼ " : ""}
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 font-semibold tabular">{children}</div>
    </div>
  );
}

export function SentimentBadge({ label, score }: { label: SentimentLabel; score?: number }) {
  const meta = SENTIMENT_META[label];
  const tone =
    meta.tone === "bullish"
      ? "bg-bull/15 text-bull border-bull/30"
      : meta.tone === "bearish"
      ? "bg-bear/15 text-bear border-bear/30"
      : "bg-white/5 text-ink-soft border-line";
  return (
    <span className={`chip border ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulseSoft" />
      {meta.text}
      {score != null && <span className="tabular opacity-70">{score > 0 ? "+" : ""}{score}</span>}
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, string> = {
  Low: "bg-bull/15 text-bull",
  Medium: "bg-accent/15 text-accent",
  High: "bg-warn/15 text-warn",
  "Very High": "bg-bear/15 text-bear",
};
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`chip ${RISK_TONE[level]}`}>{level} risk</span>;
}

export function ConvictionDial({ value, size = 64 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(10, value)) / 10;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 8 ? "#22c55e" : value >= 6.5 ? "#38bdf8" : value >= 5 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2c3d" strokeWidth={6} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold tabular leading-none" style={{ fontSize: size * 0.26 }}>
          {value.toFixed(1)}
        </span>
        <span className="text-[9px] text-ink-dim">/ 10</span>
      </div>
    </div>
  );
}

export function MiniBar({ value, max = 10, tone = "accent" }: { value: number; max?: number; tone?: string }) {
  const colors: Record<string, string> = {
    accent: "bg-accent",
    bull: "bg-bull",
    bear: "bg-bear",
    warn: "bg-warn",
  };
  return (
    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
      <div
        className={`h-full rounded-full ${colors[tone] ?? colors.accent}`}
        style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }}
      />
    </div>
  );
}

export function Card({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card card-pad animate-slideUp ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between mb-3">
          <h3 className="section-title">
            {icon}
            {title}
          </h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function DirArrow({ dir }: { dir: Direction }) {
  if (dir === "bullish") return <span className="text-bull">↑</span>;
  if (dir === "bearish") return <span className="text-bear">↓</span>;
  return <span className="text-ink-soft">→</span>;
}
