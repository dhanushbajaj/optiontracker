import { useApp } from "../store";
import type { MarketSnapshot, SectorPerf, NewsItem } from "../types";
import { Card, Chip, Delta, SentimentBadge, MiniBar } from "./ui";
import { BIAS_META } from "../engines/sentiment";
import { fmtUsd, fmtPct, fmtCompact, fmtTime, fmtDateShort, colorFor } from "../lib/format";

// ---- Market overview: indices, macro, VIX, breadth -------------------------
export function MarketOverview({ snap }: { snap: MarketSnapshot }) {
  return (
    <Card title="Market Overview" icon={<span>🌐</span>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {snap.indices.map((i) => (
          <div key={i.symbol} className="rounded-xl bg-bg-soft border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">{i.symbol}</span>
              <Delta value={i.changePct} className="text-xs" />
            </div>
            <div className="text-[11px] text-ink-dim">{i.name}</div>
            <div className="tabular text-sm mt-1">{fmtUsd(i.price)}</div>
            {i.futuresChangePct != null && (
              <div className="text-[10px] text-ink-dim mt-0.5">
                Fut <span className={colorFor(i.futuresChangePct)}>{fmtPct(i.futuresChangePct)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-2">
        <MacroTile label="VIX" value={snap.vix.toFixed(2)} change={snap.vixChangePct} invert />
        {snap.macro.map((m) => (
          <MacroTile
            key={m.symbol}
            label={m.symbol}
            value={(m.unit === "$" ? "$" : "") + m.value.toLocaleString() + (m.unit === "%" ? "%" : "")}
            change={m.changePct}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs">
        <span className="text-ink-dim">Breadth</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden flex">
          <div className="bg-bull" style={{ width: `${(snap.advancers / (snap.advancers + snap.decliners)) * 100}%` }} />
          <div className="bg-bear flex-1" />
        </div>
        <span className="tabular text-bull">{snap.advancers} adv</span>
        <span className="tabular text-bear">{snap.decliners} dec</span>
      </div>
    </Card>
  );
}

function MacroTile({ label, value, change, invert }: { label: string; value: string; change: number; invert?: boolean }) {
  return (
    <div className="rounded-lg bg-bg-soft border border-line px-2.5 py-2">
      <div className="text-[10px] text-ink-dim font-semibold">{label}</div>
      <div className="tabular text-sm font-semibold">{value}</div>
      <Delta value={change} className="text-[10px]" />
    </div>
  );
}

// ---- Sentiment panel -------------------------------------------------------
export function SentimentPanel() {
  const { scan } = useApp();
  if (!scan) return null;
  const s = scan.report.sentiment;
  const pct = (s.score + 100) / 200;
  return (
    <Card title="Market Sentiment Engine" icon={<span>🧭</span>} action={<SentimentBadge label={s.label} score={s.score} />}>
      <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-bear via-warn to-bull">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-5 bg-white rounded-sm shadow-lg border border-black/30"
          style={{ left: `calc(${pct * 100}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-ink-dim mt-1">
        <span>Strong Bearish</span>
        <span>Neutral</span>
        <span>Strong Bullish</span>
      </div>

      <div className="mt-3 rounded-xl bg-accent/10 border border-accent/30 p-3">
        <div className="text-xs font-semibold text-accent">Recommended environment</div>
        <div className="text-sm font-semibold mt-0.5">{BIAS_META[s.bias]}</div>
      </div>

      <p className="text-sm text-ink-soft mt-3 leading-relaxed">{s.summary}</p>

      <div className="mt-3 space-y-1.5">
        {s.drivers.slice(0, 7).map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${d.signal === "bullish" ? "bg-bull" : d.signal === "bearish" ? "bg-bear" : "bg-ink-dim"}`} />
            <span className="text-ink-soft w-36 shrink-0">{d.label}</span>
            <span className="tabular font-medium">{d.value}</span>
            <span className="ml-auto text-ink-dim">{d.weight}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- Top movers ------------------------------------------------------------
export function MoversPanel({ snap }: { snap: MarketSnapshot }) {
  const sorted = [...snap.quotes].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();
  const { toggleWatch, watchlist } = useApp();
  const Row = ({ q }: { q: (typeof gainers)[0] }) => (
    <button
      onClick={() => toggleWatch(q.ticker)}
      className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-bg-hover text-left"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${watchlist.includes(q.ticker) ? "bg-accent" : "bg-transparent"}`} />
      <span className="font-semibold text-sm w-14">{q.ticker}</span>
      <span className="tabular text-xs text-ink-soft w-16">{fmtUsd(q.price)}</span>
      <span className="text-[10px] text-ink-dim ml-1">{(q.volume / q.avgVolume).toFixed(1)}x vol</span>
      <Delta value={q.changePct} className="text-xs ml-auto" />
    </button>
  );
  return (
    <Card title="Top Movers" icon={<span>📊</span>} action={<span className="text-[10px] text-ink-dim">click to watch</span>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-bull mb-1">Gainers</div>
          {gainers.map((q) => <Row key={q.ticker} q={q} />)}
        </div>
        <div>
          <div className="text-xs font-semibold text-bear mb-1">Losers</div>
          {losers.map((q) => <Row key={q.ticker} q={q} />)}
        </div>
      </div>
    </Card>
  );
}

// ---- Sector heatmap --------------------------------------------------------
export function SectorPanel({ sectors }: { sectors: SectorPerf[] }) {
  const rotationTone: Record<SectorPerf["rotation"], string> = {
    leading: "bg-bull/20 text-bull",
    improving: "bg-bull/10 text-bull",
    weakening: "bg-bear/10 text-bear",
    lagging: "bg-bear/20 text-bear",
  };
  return (
    <Card title="Sector Rotation" icon={<span>🔁</span>}>
      <div className="space-y-1.5">
        {sectors.map((s) => (
          <div key={s.sector} className="flex items-center gap-2">
            <span className="text-xs w-40 shrink-0 truncate">{s.sector}</span>
            <span className="text-[10px] text-ink-dim w-9">{s.etf}</span>
            <div className="flex-1">
              <div className="h-4 rounded bg-white/5 relative overflow-hidden">
                <div
                  className={`absolute top-0 bottom-0 ${s.changePct >= 0 ? "left-1/2 bg-bull/50" : "right-1/2 bg-bear/50"}`}
                  style={{ width: `${Math.min(50, Math.abs(s.changePct) * 18)}%` }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line" />
              </div>
            </div>
            <Delta value={s.changePct} className="text-xs w-16 text-right" />
            <span className={`chip ${rotationTone[s.rotation]} w-24 justify-center`}>{s.rotation}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- News feed -------------------------------------------------------------
const NEWS_TONE: Record<NewsItem["kind"], { label: string; cls: string }> = {
  bullish_catalyst: { label: "Bullish", cls: "bg-bull/15 text-bull" },
  bearish_catalyst: { label: "Bearish", cls: "bg-bear/15 text-bear" },
  macro: { label: "Macro", cls: "bg-accent/15 text-accent" },
  neutral: { label: "Neutral", cls: "bg-white/5 text-ink-soft" },
};
export function NewsPanel({ snap }: { snap: MarketSnapshot }) {
  return (
    <Card title="Breaking News & Catalysts" icon={<span>📰</span>} action={<span className="text-[10px] text-ink-dim">{snap.news.length} items · impact-scored</span>}>
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {snap.news.map((n) => (
          <div key={n.id} className="rounded-xl bg-bg-soft border border-line p-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`chip ${NEWS_TONE[n.kind].cls}`}>{NEWS_TONE[n.kind].label}</span>
              {n.impact === "high" && <Chip tone="warn">High impact</Chip>}
              {n.ticker && <span className="text-xs font-bold">{n.ticker}</span>}
              <span className="text-[10px] text-ink-dim ml-auto">{n.source} · {fmtTime(n.time)}</span>
            </div>
            <div className="text-sm font-medium leading-snug">{n.headline}</div>
            <div className="text-xs text-ink-soft mt-1">{n.summary}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- Analyst actions -------------------------------------------------------
export function AnalystPanel({ snap }: { snap: MarketSnapshot }) {
  const tone = (a: string) => (a === "upgrade" ? "bullish" : a === "downgrade" ? "bearish" : "accent");
  return (
    <Card title="Analyst Upgrades / Downgrades" icon={<span>🎯</span>}>
      <div className="space-y-1.5">
        {snap.analyst.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm py-1">
            <span className="font-bold w-14">{a.ticker}</span>
            <Chip tone={tone(a.action) as "bullish" | "bearish" | "accent"}>
              {a.action === "pt_change" ? "PT" : a.action}
            </Chip>
            <span className="text-xs text-ink-soft truncate">
              {a.firm}
              {a.toRating ? ` → ${a.toRating}` : ""}
            </span>
            {a.priceTarget && (
              <span className="ml-auto tabular text-xs">
                {a.prevTarget ? `${fmtUsd(a.prevTarget, 0)} → ` : ""}
                <span className="font-semibold">{fmtUsd(a.priceTarget, 0)}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
