import { useEffect, useState } from "react";
import { Card } from "./ui";
import { useApp } from "../store";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC as string | undefined;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationSetup() {
  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [sub, setSub] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => s && setSub(JSON.stringify(s)))
      .catch(() => {});
  }, []);

  const enable = async () => {
    setStatus("");
    try {
      const permission = await Notification.requestPermission();
      setPerm(permission);
      if (permission !== "granted") {
        setStatus("Permission denied — enable notifications for this site in your browser settings.");
        return;
      }
      if (!VAPID_PUBLIC) {
        setStatus(
          "No VAPID public key configured. Generate keys (npx web-push generate-vapid-keys), then set VITE_VAPID_PUBLIC at build time. Email alerts still work without this."
        );
        // still show a local test notification
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification("Option Oracle alerts enabled ✅", {
          body: "You'll get a test like this. Add VAPID keys to receive scheduled push from the cloud.",
          icon: "./icon.svg",
        });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const json = JSON.stringify(subscription);
      setSub(json);
      setStatus("Subscribed! Copy the token below into the PUSH_SUBSCRIPTIONS GitHub secret.");
      reg.showNotification("Option Oracle alerts enabled ✅", {
        body: "Scheduled 9AM/9PM reports will now push to this device.",
        icon: "./icon.svg",
      });
    } catch (e) {
      setStatus("Subscribe failed: " + (e as Error).message);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(sub).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card title="Phone Alerts (Web Push)" icon={<span>📱</span>}>
      <p className="text-sm text-ink-soft mb-3">
        Install this app to your home screen (Share → Add to Home Screen), then enable push to get
        the 9 AM / 9 PM reports and high-conviction setups straight to your phone. Email alerts are
        sent automatically by the scheduled job.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn btn-accent" onClick={enable} disabled={perm === "granted" && !!sub}>
          {perm === "granted" && sub ? "✓ Notifications enabled" : "Enable phone alerts"}
        </button>
        <span className="text-xs text-ink-dim">
          Permission: <span className="font-semibold">{perm}</span>
        </span>
      </div>
      {status && <p className="text-xs text-warn mt-2">{status}</p>}
      {sub && (
        <div className="mt-3">
          <div className="stat-label mb-1">Your push subscription token</div>
          <textarea
            readOnly
            value={sub}
            className="w-full h-24 text-[10px] font-mono bg-bg-soft border border-line rounded-lg p-2 text-ink-soft"
          />
          <div className="flex items-center gap-2 mt-1">
            <button className="btn !py-1.5 !px-3 text-xs" onClick={copy}>
              {copied ? "Copied ✓" : "Copy token"}
            </button>
            <span className="text-[11px] text-ink-dim">
              Paste into repo secret <code className="text-accent">PUSH_SUBSCRIPTIONS</code> (JSON array for multiple devices).
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

export function LiveDataKeyCard() {
  const { liveKey, setLiveKey, refresh } = useApp();
  const [draft, setDraft] = useState(liveKey);
  const [show, setShow] = useState(false);
  const active = !!liveKey;

  const apply = () => {
    setLiveKey(draft);
    refresh();
  };
  const clear = () => {
    setDraft("");
    setLiveKey("");
    refresh();
  };

  return (
    <Card title="Live Data Key (on-demand)" icon={<span>🔑</span>}>
      <p className="text-sm text-ink-soft mb-3">
        Paste your free <a href="https://finnhub.io" target="_blank" rel="noreferrer" className="text-accent hover:underline">Finnhub</a> key
        to make the <span className="font-semibold">↻ refresh</span> button run a real live scan from your browser.
        Without it, the app shows the scheduled 9 AM / 9 PM reports (the secure default).
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type={show ? "text" : "password"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Finnhub API key"
          className="flex-1 min-w-[180px] bg-bg-soft border border-line rounded-lg px-3 py-2 text-sm font-mono"
        />
        <button className="btn !py-2 !px-3 text-xs" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </button>
        <button className="btn btn-accent" onClick={apply} disabled={!draft.trim() || draft === liveKey}>
          {active && draft === liveKey ? "✓ Active" : "Use live"}
        </button>
        {active && (
          <button className="btn !py-2 !px-3 text-xs" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className={`text-xs mt-2 ${active ? "text-bull" : "text-ink-dim"}`}>
        {active ? "🟢 Live mode active — refresh pulls real-time Finnhub data." : "Using scheduled reports / sample data."}
      </div>
      <p className="text-[11px] text-ink-dim mt-2 leading-relaxed">
        Stored only in this browser (localStorage) and sent directly to Finnhub. For the scheduled
        cloud scans + notifications, set <code className="text-accent">FINNHUB_API_KEY</code> as a GitHub secret instead.
      </p>
    </Card>
  );
}

export function DataSourcesCard() {
  const { meta } = useApp();
  return (
    <Card title="Data & Status" icon={<span>🛰️</span>}>
      <div className="space-y-2 text-sm">
        <Row label="Data mode" value={meta?.dataMode === "live" ? "🟢 Live (Finnhub)" : "🟡 Sample / mock"} />
        <Row label="Provider" value={meta?.provider ?? "mock"} />
        <Row label="Last generated" value={meta ? new Date(meta.generatedAt).toLocaleString() : "—"} />
      </div>
      {meta?.note && <p className="text-xs text-ink-dim mt-3 leading-relaxed">{meta.note}</p>}
      <div className="mt-3 text-[11px] text-ink-dim leading-relaxed border-t border-line pt-3">
        <strong className="text-ink-soft">Live:</strong> quotes, news, earnings, analyst trends ·{" "}
        <strong className="text-ink-soft">Derived:</strong> technicals, news sentiment ·{" "}
        <strong className="text-ink-soft">Modeled:</strong> options chains, IV, flow (no free options data — swap in Polygon/Tradier for real chains).
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-dim text-xs">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
