import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sendNotifications, type NotifySummary } from "../api/_notify";

// ============================================================================
// Local / GitHub-Actions notifier — reads the summary written by runScan and
// dispatches email + web push via the shared module (api/_notify.ts). The
// Vercel cron (api/cron.ts) uses the same sender without touching the disk.
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUMMARY = resolve(__dirname, "../public/data/last-summary.json");

async function main() {
  if (!existsSync(SUMMARY)) {
    console.log("No summary found — run a scan first.");
    return;
  }
  const s = JSON.parse(readFileSync(SUMMARY, "utf8")) as NotifySummary;
  const results = await sendNotifications(s);
  results.forEach((r) => console.log("•", r));
  console.log("✅ Notifications dispatched.");
}

main().catch((e) => {
  console.error("Notify failed:", e);
  process.exit(0); // never fail the workflow over notifications
});
