import { useState } from "react";
import { useApp } from "../store";
import { Card, Chip } from "./ui";
import { AdvancedChart, MiniChart, tvSymbol } from "./TradingView";

// Full Charts page: searchable interactive chart + quick picks.
export function ChartsView() {
  const { scan, watchlist } = useApp();
  const top = scan?.report.topIdea?.ticker;
  const [symbol, setSymbol] = useState<string>(top || "SPY");
  const [draft, setDraft] = useState("");

  const universe = scan ? scan.snapshot.quotes.map((q) => q.ticker) : [];
  const picks = Array.from(new Set([...(top ? [top] : []), "SPY", "QQQ", ...watchlist, ...universe])).slice(0, 16);

  const go = (s: string) => {
    const t = s.trim().toUpperCase();
    if (t) setSymbol(t);
  };

  return (
    <div className="space-y-4">
      <Card title="Live Chart" icon={<span>📈</span>} action={<Chip tone="accent">{symbol}</Chip>}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(draft);
              setDraft("");
            }}
            className="flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search ticker (e.g. AAPL)"
              className="bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm uppercase w-44"
            />
            <button className="btn btn-accent" type="submit">Load</button>
          </form>
          <div className="flex items-center gap-1.5 flex-wrap">
            {picks.map((t) => (
              <button
                key={t}
                onClick={() => go(t)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  t === symbol ? "border-accent/50 bg-accent/15 text-accent" : "border-line text-ink-soft hover:bg-bg-hover"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <AdvancedChart symbol={tvSymbol(symbol)} height={520} />
      </Card>
    </div>
  );
}

// Compact strip for the dashboard: SPY + QQQ + the top-idea ticker.
export function DashboardCharts() {
  const { scan } = useApp();
  const top = scan?.report.topIdea?.ticker;
  const syms = Array.from(new Set(["SPY", "QQQ", ...(top ? [top] : [])])).slice(0, 3);
  return (
    <Card title="Index & Setup Charts" icon={<span>📈</span>}>
      <div className="grid sm:grid-cols-3 gap-3">
        {syms.map((s) => (
          <div key={s}>
            <div className="text-xs font-semibold text-ink-soft mb-1">{s}</div>
            <MiniChart symbol={tvSymbol(s)} height={130} />
          </div>
        ))}
      </div>
    </Card>
  );
}
