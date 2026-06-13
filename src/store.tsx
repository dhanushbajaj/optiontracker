import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { registerProvider, getProvider } from "./data/provider";
import { MockProvider } from "./data/mockProvider";
import { FinnhubProvider } from "./data/finnhubProvider";
import { runScan, type ScanResult } from "./engines/report";
import type {
  ReportType,
  SavedIdea,
  JournalEntry,
  AppAlert,
  TradeIdea,
} from "./types";

// Register the active data provider. Swap MockProvider for a live provider here.
registerProvider(new MockProvider());

export interface ScanMeta {
  dataMode: "live" | "mock";
  generatedAt: string;
  session: ReportType;
  provider?: string;
  note?: string;
}

interface AppState {
  session: ReportType;
  setSession: (s: ReportType) => void;
  scan: ScanResult | null;
  meta: ScanMeta | null;
  loading: boolean;
  refresh: () => void;
  liveKey: string;
  setLiveKey: (k: string) => void;
  watchlist: string[];
  toggleWatch: (t: string) => void;
  saved: SavedIdea[];
  saveIdea: (i: TradeIdea) => void;
  removeSaved: (id: string) => void;
  journal: JournalEntry[];
  addJournal: (e: Omit<JournalEntry, "id" | "createdAt">) => void;
  updateJournal: (id: string, status: JournalEntry["status"]) => void;
  alerts: AppAlert[];
  dismissAlert: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Default the session to whatever is closest to "now": morning before 3pm.
  const [session, setSession] = useState<ReportType>(() =>
    new Date().getHours() < 15 ? "morning" : "evening"
  );
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [loading, setLoading] = useState(true);
  // Optional: a Finnhub key the user pastes in-app for on-demand live scans
  // straight from the browser. Stored locally only (never sent anywhere but Finnhub).
  const [liveKey, setLiveKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem("oo.finnhubKey") || "";
    } catch {
      return "";
    }
  });

  const [watchlist, setWatchlist] = useState<string[]>(() =>
    load("oo.watch", ["NVDA", "TSLA", "AMD", "SPY"])
  );
  const [saved, setSaved] = useState<SavedIdea[]>(() => load("oo.saved", []));
  const [journal, setJournal] = useState<JournalEntry[]>(() => load("oo.journal", []));
  const [alerts, setAlerts] = useState<AppAlert[]>([]);

  // Guard against overlapping scans (React StrictMode double-invoke, rapid
  // session/key changes) — a live scan fires dozens of Finnhub calls and we
  // must not double them into the rate limit.
  const scanning = useRef(false);
  const refresh = useCallback(async () => {
    if (scanning.current) return;
    scanning.current = true;
    setLoading(true);
    try {
      // 0) If the user supplied a Finnhub key, run a real live scan in-browser.
      if (liveKey) {
        try {
          const provider = new FinnhubProvider({ apiKey: liveKey, gapMs: 300 });
          const snap = await provider.getSnapshot(session);
          // If we got starved by the rate limit, the snapshot will be sparse —
          // fall back to the last good report rather than render a broken one.
          if (snap.quotes.length < 5 || snap.indices.length < 2) {
            throw new Error("Live data too sparse (likely rate-limited) — using last report");
          }
          const result = runScan(snap, session);
          setScan(result);
          setMeta({
            dataMode: "live",
            generatedAt: snap.asOf,
            session,
            provider: "finnhub (browser)",
            note: "Live on-demand scan run from your browser with your Finnhub key.",
          });
          setAlerts(buildAlerts(result, session));
          return;
        } catch (e) {
          console.warn("Live in-browser scan failed, falling back:", e);
        }
      }
      // 1) Prefer the pre-generated report committed by the scheduled scan.
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/latest-${session}.json`, {
          cache: "no-store",
        });
        if (res.ok) {
          const bundle = await res.json();
          if (bundle?.scan?.report) {
            setScan(bundle.scan as ScanResult);
            setMeta(bundle.meta as ScanMeta);
            setAlerts(buildAlerts(bundle.scan as ScanResult, session));
            return;
          }
        }
      } catch {
        /* fall through to local mock */
      }
      // 2) Local dev / no data yet: run the engines client-side on mock data.
      const snap = await getProvider().getSnapshot(session);
      const result = runScan(snap, session);
      setScan(result);
      setMeta({
        dataMode: "mock",
        generatedAt: snap.asOf,
        session,
        note: "Live report not found — showing sample analysis generated in-browser.",
      });
      setAlerts(buildAlerts(result, session));
    } finally {
      scanning.current = false;
      setLoading(false);
    }
  }, [session, liveKey]);

  const setLiveKey = useCallback((k: string) => {
    const key = k.trim();
    try {
      if (key) localStorage.setItem("oo.finnhubKey", key);
      else localStorage.removeItem("oo.finnhubKey");
    } catch {
      /* ignore */
    }
    setLiveKeyState(key);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => save("oo.watch", watchlist), [watchlist]);
  useEffect(() => save("oo.saved", saved), [saved]);
  useEffect(() => save("oo.journal", journal), [journal]);

  const toggleWatch = useCallback(
    (t: string) =>
      setWatchlist((w) => (w.includes(t) ? w.filter((x) => x !== t) : [...w, t])),
    []
  );

  const saveIdea = useCallback(
    (i: TradeIdea) =>
      setSaved((s) =>
        s.some((x) => x.id === i.id)
          ? s
          : [{ ...i, savedAt: new Date().toISOString(), reportType: session }, ...s]
      ),
    [session]
  );
  const removeSaved = useCallback(
    (id: string) => setSaved((s) => s.filter((x) => x.id !== id)),
    []
  );

  const addJournal = useCallback(
    (e: Omit<JournalEntry, "id" | "createdAt">) =>
      setJournal((j) => [
        { ...e, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
        ...j,
      ]),
    []
  );
  const updateJournal = useCallback(
    (id: string, status: JournalEntry["status"]) =>
      setJournal((j) => j.map((e) => (e.id === id ? { ...e, status } : e))),
    []
  );

  const dismissAlert = useCallback(
    (id: string) => setAlerts((a) => a.filter((x) => x.id !== id)),
    []
  );

  const value = useMemo(
    () => ({
      session,
      setSession,
      scan,
      meta,
      loading,
      refresh,
      liveKey,
      setLiveKey,
      watchlist,
      toggleWatch,
      saved,
      saveIdea,
      removeSaved,
      journal,
      addJournal,
      updateJournal,
      alerts,
      dismissAlert,
    }),
    [session, scan, meta, loading, refresh, liveKey, setLiveKey, watchlist, toggleWatch, saved, saveIdea, removeSaved, journal, addJournal, updateJournal, alerts, dismissAlert]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}

function buildAlerts(scan: ScanResult, session: ReportType): AppAlert[] {
  const out: AppAlert[] = [];
  const now = new Date().toISOString();
  out.push({
    id: "report",
    level: "info",
    title: `${session === "morning" ? "9:00 AM Market Prep" : "9:00 PM Market Recap"} report is ready`,
    body: scan.report.headline,
    time: now,
  });
  const top = scan.report.topIdea;
  if (top) {
    out.push({
      id: "topidea",
      level: top.direction === "bullish" ? "bull" : "bear",
      title: `High-conviction setup: ${top.ticker} ${top.optionType.toUpperCase()} (${top.conviction.toFixed(1)}/10)`,
      body: top.invalidation,
      time: now,
    });
  }
  // unusual options activity alert from biggest premium
  const flow = scan.snapshot.flow[0];
  if (flow) {
    out.push({
      id: "uoa",
      level: flow.sentiment === "bullish" ? "bull" : "bear",
      title: `Unusual options activity: ${flow.ticker} ${flow.type.toUpperCase()} sweep`,
      body: `$${(flow.premium / 1e6).toFixed(1)}M in ${flow.size.toLocaleString()} contracts at the ${flow.aggressor}.`,
      time: now,
    });
  }
  // high IV warning
  const hot = scan.snapshot.quotes.find((q) => q.ivRank > 70);
  if (hot)
    out.push({
      id: "iv",
      level: "warn",
      title: `Elevated IV warning: ${hot.ticker}`,
      body: `IV rank ${hot.ivRank} — long premium is expensive and exposed to IV crush.`,
      time: now,
    });
  return out;
}
