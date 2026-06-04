import { useApp } from "../store";
import { Card, Chip, Delta, SentimentBadge } from "./ui";
import { TradeIdeaCard } from "./TradeIdeaCard";
import { BIAS_META } from "../engines/sentiment";
import { fmtDate, fmtTime } from "../lib/format";

export function ReportView() {
  const { scan, session } = useApp();
  if (!scan) return null;
  const r = scan.report;
  const title = session === "morning" ? "9:00 AM Market Prep Report" : "9:00 PM Market Recap & Game Plan";

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="!p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-accent/15 to-transparent p-5 border-b border-line">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-accent font-semibold">
                {session === "morning" ? "Morning Prep" : "Evening Recap"}
              </div>
              <h2 className="text-xl font-bold mt-0.5">{title}</h2>
              <div className="text-xs text-ink-dim mt-1">
                Generated {fmtDate(r.generatedAt)} · {fmtTime(r.generatedAt)} · AI analyst desk
              </div>
            </div>
            <SentimentBadge label={r.sentiment.label} score={r.sentiment.score} />
          </div>
          <p className="text-sm text-ink-soft mt-3 leading-relaxed max-w-3xl">{r.narrative}</p>
          <div className="mt-3">
            <Chip tone="accent">{BIAS_META[r.sentiment.bias]}</Chip>
          </div>
        </div>
      </Card>

      {/* Highest conviction */}
      {r.topIdea && (
        <div>
          <SectionLabel>★ Highest-Conviction Trade Idea</SectionLabel>
          <TradeIdeaCard idea={r.topIdea} featured />
        </div>
      )}

      {/* Alt call/put */}
      <div className="grid lg:grid-cols-2 gap-4">
        {r.altCallIdea && (
          <div>
            <SectionLabel>Best Call Setup</SectionLabel>
            <TradeIdeaCard idea={r.altCallIdea} />
          </div>
        )}
        {r.altPutIdea && (
          <div>
            <SectionLabel>Best Put Setup</SectionLabel>
            <TradeIdeaCard idea={r.altPutIdea} />
          </div>
        )}
      </div>

      {/* Drivers + sectors */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Key Market Drivers" icon={<span>⚡</span>}>
          <ul className="space-y-2">
            {r.drivers.map((d, i) => (
              <li key={i} className="text-sm text-ink-soft flex gap-2">
                <span className="text-accent">›</span>{d}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Sector Strength / Weakness" icon={<span>🏭</span>}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-bull mb-1">Strongest</div>
              {r.strongestSectors.map((s) => (
                <div key={s.sector} className="flex items-center justify-between text-sm py-0.5">
                  <span className="truncate">{s.sector}</span>
                  <Delta value={s.changePct} className="text-xs" />
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-semibold text-bear mb-1">Weakest</div>
              {r.weakestSectors.map((s) => (
                <div key={s.sector} className="flex items-center justify-between text-sm py-0.5">
                  <span className="truncate">{s.sector}</span>
                  <Delta value={s.changePct} className="text-xs" />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Setups */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Top Bullish Setups" icon={<span>🟢</span>}>
          <SetupList items={r.bullishSetups} tone="bull" />
        </Card>
        <Card title="Top Bearish Setups" icon={<span>🔴</span>}>
          <SetupList items={r.bearishSetups} tone="bear" />
        </Card>
      </div>

      {/* Earnings + levels */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Earnings To Watch" icon={<span>📅</span>}>
          <div className="space-y-2">
            {r.earningsToWatch.map((e) => (
              <div key={e.ticker} className="flex items-center gap-2 text-sm">
                <span className="font-bold w-14">{e.ticker}</span>
                <Chip tone="accent">{e.time.toUpperCase()}</Chip>
                <span className="text-xs text-ink-dim">{fmtDate(e.date)}</span>
                <span className="ml-auto text-xs text-warn">±{e.impliedMovePct}% implied</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Key Levels To Watch" icon={<span>🎚️</span>}>
          <div className="space-y-1.5">
            {r.keyLevels.map((k, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="font-bold w-14">{k.ticker}</span>
                <span className="text-ink-soft text-xs">{k.note}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Game plan */}
      <Card title="Game Plan" icon={<span>🗺️</span>}>
        <ol className="space-y-2">
          {r.gamePlan.map((g, i) => (
            <li key={i} className="text-sm text-ink-soft flex gap-2.5">
              <span className="shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              {g}
            </li>
          ))}
        </ol>
      </Card>

      {/* Risk warning */}
      <div className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm">
        <div className="font-semibold text-warn mb-1">⚠ Risk Warning & Disclaimer</div>
        <p className="text-ink-soft leading-relaxed">{r.riskWarning}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-ink-dim mb-2">{children}</div>;
}

function SetupList({ items, tone }: { items: { ticker: string; reason: string; score: number; changePct: number }[]; tone: "bull" | "bear" }) {
  if (!items.length) return <div className="text-sm text-ink-dim">No qualifying setups.</div>;
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div key={s.ticker} className="flex items-start gap-2">
          <span className="font-bold w-14 shrink-0">{s.ticker}</span>
          <span className="text-xs text-ink-soft flex-1">{s.reason}</span>
          <span className={`chip ${tone === "bull" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{s.score.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
