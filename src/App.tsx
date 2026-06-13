import { useState } from "react";
import { useApp } from "./store";
import { MarketOverview, SentimentPanel, MoversPanel, SectorPanel, NewsPanel, AnalystPanel } from "./components/panels";
import { OptionsFlowPanel, EarningsPanel, WatchlistView, SavedView, JournalView } from "./components/features";
import { ReportView } from "./components/ReportView";
import { TradeIdeaCard } from "./components/TradeIdeaCard";
import { NotificationSetup, DataSourcesCard, LiveDataKeyCard } from "./components/NotificationSetup";
import { ChartsView, DashboardCharts } from "./components/ChartsView";
import { Card } from "./components/ui";
import { fmtDate, fmtTime } from "./lib/format";
import type { AppAlert } from "./types";

type View = "dashboard" | "report" | "charts" | "flow" | "earnings" | "watch" | "saved" | "journal" | "alerts";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "report", label: "Daily Report", icon: "📋" },
  { id: "charts", label: "Charts", icon: "📈" },
  { id: "flow", label: "Options Flow", icon: "🌊" },
  { id: "earnings", label: "Earnings", icon: "📅" },
  { id: "watch", label: "Watchlists", icon: "👁" },
  { id: "saved", label: "Saved Ideas", icon: "★" },
  { id: "journal", label: "Journal", icon: "📓" },
  { id: "alerts", label: "Alerts & Setup", icon: "🔔" },
];

export default function App() {
  const { session, setSession, scan, meta, loading, refresh, saved, alerts } = useApp();
  const [view, setView] = useState<View>("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-40 inset-y-0 left-0 w-60 bg-bg-soft border-r border-line flex flex-col transition-transform ${
          navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-4 border-b border-line">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-bull flex items-center justify-center font-bold text-bg">
              O
            </div>
            <div>
              <div className="font-bold leading-tight">Option Oracle</div>
              <div className="text-[10px] text-ink-dim">AI options desk</div>
            </div>
          </div>
        </div>
        <nav className="p-2 flex-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => { setView(n.id); setNavOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium mb-0.5 transition-colors ${
                view === n.id ? "bg-accent/15 text-accent" : "text-ink-soft hover:bg-bg-hover"
              }`}
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
              {n.id === "saved" && saved.length > 0 && (
                <span className="ml-auto text-[10px] bg-accent/20 text-accent rounded-full px-1.5">{saved.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-line text-[10px] text-ink-dim leading-relaxed">
          Educational analysis only — not financial advice. Options can lose 100% of premium.
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur border-b border-line px-4 sm:px-6 py-3 flex items-center gap-3">
          <button className="lg:hidden btn !px-2.5 !py-1.5" onClick={() => setNavOpen(true)}>☰</button>
          <div className="min-w-0">
            <h1 className="font-bold truncate flex items-center gap-2">
              {NAV.find((n) => n.id === view)?.label}
              {meta && (
                <span
                  className={`chip text-[10px] ${
                    meta.dataMode === "live" ? "bg-bull/15 text-bull" : "bg-warn/15 text-warn"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulseSoft" />
                  {meta.dataMode === "live" ? "LIVE" : "SAMPLE"}
                </span>
              )}
            </h1>
            {scan && <div className="text-[11px] text-ink-dim">As of {fmtDate(scan.snapshot.asOf)} · {fmtTime(scan.snapshot.asOf)}</div>}
          </div>

          {/* Session toggle */}
          <div className="ml-auto flex items-center gap-1 bg-bg-soft border border-line rounded-xl p-1">
            <SessionBtn active={session === "morning"} onClick={() => setSession("morning")}>☀ 9 AM Prep</SessionBtn>
            <SessionBtn active={session === "evening"} onClick={() => setSession("evening")}>🌙 9 PM Recap</SessionBtn>
          </div>
          <button onClick={refresh} className="btn !px-3" title="Re-run scan">
            <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
          </button>
        </header>

        {/* Alerts */}
        <AlertBar alerts={alerts} />

        {/* Content */}
        <main className="p-4 sm:p-6 flex-1">
          {loading || !scan ? (
            <LoadingState />
          ) : (
            <div className="max-w-6xl mx-auto">
              {view === "dashboard" && <Dashboard />}
              {view === "report" && <ReportView />}
              {view === "charts" && <ChartsView />}
              {view === "flow" && <OptionsFlowPanel snap={scan.snapshot} full />}
              {view === "earnings" && <EarningsPanel snap={scan.snapshot} />}
              {view === "watch" && <WatchlistView />}
              {view === "saved" && <SavedView />}
              {view === "journal" && <JournalView />}
              {view === "alerts" && <AlertsView alerts={alerts} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Dashboard() {
  const { scan } = useApp();
  if (!scan) return null;
  const snap = scan.snapshot;
  return (
    <div className="space-y-4">
      <MarketOverview snap={snap} />
      <DashboardCharts />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {scan.report.topIdea && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-dim mb-2">★ Highest-Conviction Trade</div>
              <TradeIdeaCard idea={scan.report.topIdea} featured />
            </div>
          )}
          <MoversPanel snap={snap} />
          <SectorPanel sectors={snap.sectors} />
          <OptionsFlowPanel snap={snap} />
        </div>
        <div className="space-y-4">
          <SentimentPanel />
          <NewsPanel snap={snap} />
          <AnalystPanel snap={snap} />
          <EarningsPanel snap={snap} />
        </div>
      </div>
    </div>
  );
}

function AlertsView({ alerts }: { alerts: AppAlert[] }) {
  const { dismissAlert } = useApp();
  const tone: Record<AppAlert["level"], string> = {
    info: "border-accent/30 bg-accent/5",
    bull: "border-bull/30 bg-bull/5",
    bear: "border-bear/30 bg-bear/5",
    warn: "border-warn/30 bg-warn/5",
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <LiveDataKeyCard />
        <NotificationSetup />
        <DataSourcesCard />
      </div>
      <Card title="Recent Alerts" icon={<span>🔔</span>}>
        {!alerts.length && <div className="text-sm text-ink-dim py-4 text-center">No active alerts.</div>}
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`rounded-xl border p-3 ${tone[a.level]}`}>
              <div className="flex items-start gap-2">
                <span className="text-sm font-semibold">{a.title}</span>
                <button onClick={() => dismissAlert(a.id)} className="ml-auto text-ink-dim hover:text-ink text-xs">✕</button>
              </div>
              <p className="text-xs text-ink-soft mt-1">{a.body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SessionBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
        active ? "bg-accent/20 text-accent" : "text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function AlertBar({ alerts }: { alerts: AppAlert[] }) {
  const { dismissAlert } = useApp();
  if (!alerts.length) return null;
  const tone: Record<AppAlert["level"], string> = {
    info: "border-accent/30 bg-accent/10",
    bull: "border-bull/30 bg-bull/10",
    bear: "border-bear/30 bg-bear/10",
    warn: "border-warn/30 bg-warn/10",
  };
  return (
    <div className="px-4 sm:px-6 pt-3 space-y-1.5">
      {alerts.slice(0, 3).map((a) => (
        <div key={a.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${tone[a.level]}`}>
          <span className="font-semibold">🔔 {a.title}</span>
          <span className="text-ink-soft text-xs truncate hidden sm:block">{a.body}</span>
          <button onClick={() => dismissAlert(a.id)} className="ml-auto text-ink-dim hover:text-ink text-xs">✕</button>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="h-32 card animate-pulseSoft" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-96 card animate-pulseSoft" />
        <div className="h-96 card animate-pulseSoft" />
      </div>
    </div>
  );
}
