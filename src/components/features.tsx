import { useState } from "react";
import { useApp } from "../store";
import type { MarketSnapshot } from "../types";
import { Card, Chip, Delta, RiskBadge } from "./ui";
import { TradeIdeaCard } from "./TradeIdeaCard";
import { fmtUsd, fmtCompact, fmtTime, fmtDate, fmtDateShort, colorFor } from "../lib/format";

// ---- Options flow ----------------------------------------------------------
export function OptionsFlowPanel({ snap, full = false }: { snap: MarketSnapshot; full?: boolean }) {
  const rows = full ? snap.flow : snap.flow.slice(0, 6);
  const bullPrem = snap.flow.filter((f) => f.sentiment === "bullish").reduce((s, f) => s + f.premium, 0);
  const bearPrem = snap.flow.filter((f) => f.sentiment === "bearish").reduce((s, f) => s + f.premium, 0);
  const total = bullPrem + bearPrem;
  return (
    <Card
      title="Unusual Options Activity"
      icon={<span>🌊</span>}
      action={
        <span className="text-[10px] text-ink-dim">
          C/P premium <span className="text-bull">{((bullPrem / total) * 100).toFixed(0)}%</span> /{" "}
          <span className="text-bear">{((bearPrem / total) * 100).toFixed(0)}%</span>
        </span>
      }
    >
      <div className="h-1.5 rounded-full overflow-hidden flex mb-3">
        <div className="bg-bull" style={{ width: `${(bullPrem / total) * 100}%` }} />
        <div className="bg-bear flex-1" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-ink-dim text-left">
              <th className="font-semibold py-1">Ticker</th>
              <th className="font-semibold">Contract</th>
              <th className="font-semibold">Type</th>
              <th className="font-semibold text-right">Premium</th>
              <th className="font-semibold text-right">Size</th>
              <th className="font-semibold text-right">Kind</th>
              {full && <th className="font-semibold text-right">Time</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-line/60">
                <td className="py-2 font-bold">{f.ticker}</td>
                <td className="tabular text-xs text-ink-soft">
                  {fmtUsd(f.strike, 0)} {fmtDateShort(f.expiry)}
                </td>
                <td>
                  <Chip tone={f.sentiment === "bullish" ? "bullish" : "bearish"}>{f.type.toUpperCase()}</Chip>
                </td>
                <td className="text-right tabular font-semibold">${fmtCompact(f.premium)}</td>
                <td className="text-right tabular text-ink-soft">{f.size.toLocaleString()}</td>
                <td className="text-right text-xs text-ink-soft capitalize">
                  {f.kind} @ {f.aggressor}
                </td>
                {full && <td className="text-right text-xs text-ink-dim">{fmtTime(f.time)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Earnings calendar -----------------------------------------------------
export function EarningsPanel({ snap }: { snap: MarketSnapshot }) {
  const sorted = [...snap.earnings].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return (
    <Card title="Earnings Calendar" icon={<span>📅</span>}>
      <div className="space-y-2">
        {sorted.map((e) => {
          const reported = e.epsActual != null;
          const beat = reported && e.epsActual! >= e.epsEstimate;
          return (
            <div key={e.ticker} className="rounded-xl bg-bg-soft border border-line p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{e.ticker}</span>
                <Chip tone="accent">{e.time.toUpperCase()}</Chip>
                <span className="text-xs text-ink-dim">{fmtDate(e.date)}</span>
                {e.ivRank > 60 && <Chip tone="warn">High IV {e.ivRank}</Chip>}
                {reported && (
                  <Chip tone={beat ? "bullish" : "bearish"}>{beat ? "Beat" : "Miss"}</Chip>
                )}
                {e.guidance && <Chip tone={e.guidance === "raised" ? "bullish" : e.guidance === "cut" ? "bearish" : "neutral"}>Guide {e.guidance}</Chip>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                <div><span className="text-ink-dim">EPS est </span><span className="tabular">{e.epsEstimate.toFixed(2)}</span></div>
                {reported && <div><span className="text-ink-dim">EPS act </span><span className={`tabular ${beat ? "text-bull" : "text-bear"}`}>{e.epsActual!.toFixed(2)}</span></div>}
                <div><span className="text-ink-dim">Implied move </span><span className="tabular">±{e.impliedMovePct}%</span></div>
                <div><span className="text-ink-dim">Avg move </span><span className="tabular">±{e.histAvgMovePct}%</span></div>
              </div>
              <div className="text-[11px] text-warn mt-1.5">
                ⚠ Implied move ±{e.impliedMovePct}% — options pricing in a large gap. Watch IV-crush risk.
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---- Watchlists (bullish / bearish) ----------------------------------------
export function WatchlistView() {
  const { scan, watchlist, toggleWatch } = useApp();
  if (!scan) return null;
  const { bullishSetups, bearishSetups } = scan.report;
  const Column = ({ title, tone, items }: { title: string; tone: "bull" | "bear"; items: typeof bullishSetups }) => (
    <Card title={title} icon={<span>{tone === "bull" ? "🟢" : "🔴"}</span>}>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.ticker} className="rounded-xl bg-bg-soft border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="font-bold">{s.ticker}</span>
              <Delta value={s.changePct} className="text-xs" />
              <span className="text-[10px] text-ink-dim">RS {s.relStrength > 0 ? "+" : ""}{s.relStrength}</span>
              <span className={`ml-auto chip ${tone === "bull" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{s.score.toFixed(1)}/10</span>
            </div>
            <div className="text-xs text-ink-soft mt-1 truncate">{s.reason}</div>
            <button onClick={() => toggleWatch(s.ticker)} className="text-[11px] text-accent mt-1 hover:underline">
              {watchlist.includes(s.ticker) ? "★ on watchlist" : "☆ add to watchlist"}
            </button>
          </div>
        ))}
        {!items.length && <div className="text-sm text-ink-dim">No qualifying setups.</div>}
      </div>
    </Card>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Column title="Bullish Watchlist" tone="bull" items={bullishSetups} />
      <Column title="Bearish Watchlist" tone="bear" items={bearishSetups} />
    </div>
  );
}

// ---- Saved ideas -----------------------------------------------------------
export function SavedView() {
  const { saved } = useApp();
  if (!saved.length)
    return (
      <Card title="Saved Trade Ideas" icon={<span>★</span>}>
        <div className="text-sm text-ink-dim py-6 text-center">
          No saved ideas yet. Hit “☆ Save idea” on any setup to track it here.
        </div>
      </Card>
    );
  return (
    <div className="space-y-4">
      {saved.map((i) => (
        <TradeIdeaCard key={i.id} idea={i} />
      ))}
    </div>
  );
}

// ---- Trade journal ---------------------------------------------------------
export function JournalView() {
  const { journal, addJournal, updateJournal, scan } = useApp();
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [prem, setPrem] = useState("");
  const [dir, setDir] = useState<"bullish" | "bearish">("bullish");

  const submit = () => {
    if (!ticker.trim()) return;
    addJournal({
      ticker: ticker.toUpperCase().trim(),
      direction: dir,
      note: note.trim(),
      entryPremium: parseFloat(prem) || 0,
      status: "open",
    });
    setTicker(""); setNote(""); setPrem("");
  };

  const stats = {
    open: journal.filter((j) => j.status === "open").length,
    win: journal.filter((j) => j.status === "win").length,
    loss: journal.filter((j) => j.status === "loss").length,
  };
  const closed = stats.win + stats.loss;
  const winRate = closed ? Math.round((stats.win / closed) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card title="Trade Journal" icon={<span>📓</span>} action={
        <span className="text-xs text-ink-soft">Win rate <span className="font-semibold text-bull">{winRate}%</span> · {stats.open} open</span>
      }>
        <div className="grid sm:grid-cols-5 gap-2">
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker"
            className="bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm uppercase" />
          <select value={dir} onChange={(e) => setDir(e.target.value as "bullish" | "bearish")}
            className="bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm">
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
          <input value={prem} onChange={(e) => setPrem(e.target.value)} placeholder="Entry premium" type="number"
            className="bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / thesis"
            className="bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm sm:col-span-1" />
          <button onClick={submit} className="btn btn-accent">+ Log trade</button>
        </div>
      </Card>

      <Card title="Entries" icon={<span>🗂️</span>}>
        {!journal.length && <div className="text-sm text-ink-dim py-4 text-center">No journal entries yet.</div>}
        <div className="space-y-2">
          {journal.map((j) => (
            <div key={j.id} className="flex items-center gap-3 rounded-xl bg-bg-soft border border-line p-3">
              <span className="font-bold w-14">{j.ticker}</span>
              <Chip tone={j.direction === "bullish" ? "bullish" : "bearish"}>{j.direction}</Chip>
              <span className="text-xs text-ink-soft truncate flex-1">{j.note || "—"}</span>
              <span className="tabular text-xs text-ink-dim">{j.entryPremium ? fmtUsd(j.entryPremium) : ""}</span>
              <select
                value={j.status}
                onChange={(e) => updateJournal(j.id, e.target.value as "open" | "win" | "loss" | "scratch")}
                className={`text-xs rounded-lg px-2 py-1 border border-line bg-bg ${
                  j.status === "win" ? "text-bull" : j.status === "loss" ? "text-bear" : "text-ink-soft"
                }`}
              >
                <option value="open">Open</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="scratch">Scratch</option>
              </select>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
