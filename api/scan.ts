import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FinnhubProvider } from "../src/data/finnhubProvider";
import { MockProvider } from "../src/data/mockProvider";
import { runScan } from "../src/engines/report";
import type { ReportType } from "../src/types";

// ============================================================================
// Vercel serverless function — the dynamic data endpoint.
//
// GET /api/scan?session=morning|evening|auto
//
// Runs the full pipeline server-side with live Finnhub data (key hidden in the
// FINNHUB_API_KEY env var, never shipped to the browser) and returns the report
// bundle. Results are cached ~5 min in two layers so visitors share one fetch
// and we stay far under Finnhub's free 60/min limit:
//   • module-level cache (warm Lambda reuse)
//   • CDN via Cache-Control: s-maxage
// ============================================================================

export const config = { maxDuration: 30 };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<ReportType, { at: number; bundle: unknown }>();

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
  const session = resolveSession(req.query.session);

  // Serve warm cache if fresh.
  const hit = cache.get(session);
  if (hit && Date.now() - hit.at < TTL_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(hit.bundle);
  }

  try {
    const hasKey = !!process.env.FINNHUB_API_KEY;
    const provider = hasKey ? new FinnhubProvider({ concurrency: 6 }) : new MockProvider();
    const snapshot = await provider.getSnapshot(session);
    const result = runScan(snapshot, session);

    const bundle = {
      meta: {
        generatedAt: new Date().toISOString(),
        session,
        dataMode: hasKey ? "live" : "mock",
        provider: provider.id,
        note: hasKey
          ? "Live data from Finnhub (server-side). Technicals derived from live price/returns; options chains, IV and flow are modeled."
          : "Sample data — set FINNHUB_API_KEY in your Vercel project env for live quotes.",
      },
      scan: result,
    };

    cache.set(session, { at: Date.now(), bundle });
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(bundle);
  } catch (e) {
    // On failure, serve stale cache if we have any; otherwise error.
    if (hit) {
      res.setHeader("X-Cache", "STALE");
      return res.status(200).json(hit.bundle);
    }
    return res.status(500).json({ error: (e as Error).message });
  }
}
