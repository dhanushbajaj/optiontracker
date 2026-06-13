import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FinnhubProvider } from "../src/data/finnhubProvider";
import { MockProvider } from "../src/data/mockProvider";
import { runScan } from "../src/engines/report";
import { sendNotifications, type NotifySummary } from "./_notify";
import type { ReportType } from "../src/types";

// ============================================================================
// Vercel Cron endpoint — runs the scheduled scan and sends notifications
// (email + web push). Scheduled in vercel.json:
//   0 13 * * *  → ~09:00 ET (morning prep)
//   0  1 * * *  → ~21:00 ET (evening recap)
// The endpoint auto-resolves morning vs evening from the actual Eastern hour.
//
// Protected by CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>`
// for scheduled invocations when that env var is set.
// ============================================================================

export const config = { maxDuration: 60 };

function etHour(): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  return parseInt(s, 10) % 24;
}

function resolveSession(q: unknown): ReportType {
  if (q === "morning" || q === "evening") return q;
  return etHour() < 15 ? "morning" : "evening";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: if CRON_SECRET is configured, require the matching bearer token.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const session = resolveSession(req.query.session);
  const hasKey = !!process.env.FINNHUB_API_KEY;
  const provider = hasKey ? new FinnhubProvider({ concurrency: 6 }) : new MockProvider();

  try {
    const snapshot = await provider.getSnapshot(session);
    const { report } = runScan(snapshot, session);
    const top = report.topIdea;

    const summary: NotifySummary = {
      session,
      dataMode: hasKey ? "live" : "mock",
      generatedAt: new Date().toISOString(),
      headline: report.headline,
      sentiment: report.sentiment.label,
      sentimentScore: report.sentiment.score,
      topIdea: top
        ? {
            ticker: top.ticker,
            optionType: top.optionType,
            direction: top.direction,
            contract: `${top.ticker} $${top.contract.strike} ${top.optionType.toUpperCase()} ${top.contract.expiry}`,
            conviction: top.conviction,
            entry: `$${top.entryLow}–$${top.entryHigh}`,
            target: `$${top.targetLow}+`,
            stop: `$${top.stopPremium}`,
            invalidation: top.invalidation,
          }
        : null,
    };

    const results = await sendNotifications(summary);
    return res.status(200).json({ ok: true, session, dataMode: summary.dataMode, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
