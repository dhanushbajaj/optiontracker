import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import webpush from "web-push";

// ============================================================================
// Notifier — runs after a scan. Emails the report summary and sends a web-push
// to subscribed devices (your phone PWA). All credentials come from env /
// GitHub Secrets; if a channel isn't configured it's skipped silently.
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUMMARY = resolve(__dirname, "../public/data/last-summary.json");

interface Summary {
  session: "morning" | "evening";
  dataMode: string;
  generatedAt: string;
  headline: string;
  sentiment: string;
  sentimentScore: number;
  topIdea: {
    ticker: string;
    optionType: string;
    direction: string;
    contract: string;
    conviction: number;
    entry: string;
    target: string;
    stop: string;
    invalidation: string;
  } | null;
}

function load(): Summary | null {
  if (!existsSync(SUMMARY)) return null;
  return JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary;
}

function renderText(s: Summary): { subject: string; text: string; html: string } {
  const title = s.session === "morning" ? "🌅 9 AM Market Prep" : "🌙 9 PM Market Recap";
  const idea = s.topIdea;
  const subject = idea
    ? `${title}: ${idea.ticker} ${idea.optionType.toUpperCase()} (${idea.conviction}/10) — ${s.sentiment.replace("_", " ")}`
    : `${title} — ${s.sentiment.replace("_", " ")}`;

  const lines = [
    title,
    s.headline,
    "",
    `Market sentiment: ${s.sentiment.replace("_", " ")} (${s.sentimentScore >= 0 ? "+" : ""}${s.sentimentScore})`,
  ];
  if (idea) {
    lines.push(
      "",
      "★ HIGHEST-CONVICTION TRADE",
      `Contract: ${idea.contract}`,
      `Direction: ${idea.direction} ${idea.optionType.toUpperCase()}  ·  Conviction: ${idea.conviction}/10`,
      `Entry: ${idea.entry}   Target: ${idea.target}   Stop: ${idea.stop}`,
      `Invalidation: ${idea.invalidation}`
    );
  }
  lines.push(
    "",
    `Data mode: ${s.dataMode}`,
    "",
    "⚠ Educational analysis only — not financial advice. Options can lose 100% of premium."
  );
  const text = lines.join("\n");

  const html = `
  <div style="font-family:system-ui,Segoe UI,sans-serif;background:#0a0e14;color:#e6edf3;padding:24px;border-radius:16px;max-width:560px">
    <h2 style="margin:0 0 4px">${title}</h2>
    <p style="color:#9bb0c4;margin:0 0 16px">${s.headline}</p>
    <div style="background:#121a26;border:1px solid #1f2c3d;border-radius:12px;padding:14px;margin-bottom:12px">
      <strong>Sentiment:</strong> ${s.sentiment.replace("_", " ")} (${s.sentimentScore >= 0 ? "+" : ""}${s.sentimentScore})
    </div>
    ${
      idea
        ? `<div style="background:#121a26;border:1px solid ${idea.direction === "bullish" ? "#22c55e" : "#ef4444"}55;border-radius:12px;padding:14px">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#38bdf8">★ Highest-conviction trade</div>
            <div style="font-size:18px;font-weight:700;margin:4px 0">${idea.contract}</div>
            <div style="color:#9bb0c4">${idea.direction} ${idea.optionType.toUpperCase()} · Conviction ${idea.conviction}/10</div>
            <div style="margin-top:8px">Entry <b>${idea.entry}</b> · Target <b>${idea.target}</b> · Stop <b>${idea.stop}</b></div>
            <div style="margin-top:8px;color:#f59e0b;font-size:13px">Invalidation: ${idea.invalidation}</div>
          </div>`
        : ""
    }
    <p style="color:#5f7185;font-size:12px;margin-top:16px">Data mode: ${s.dataMode} · Educational analysis only — not financial advice. Options can lose 100% of premium.</p>
  </div>`;
  return { subject, text, html };
}

async function sendEmail(s: Summary) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_TO) {
    console.log("✉  Email not configured (SMTP_* / EMAIL_TO missing) — skipping.");
    return;
  }
  const port = parseInt(SMTP_PORT || "465", 10);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const { subject, text, html } = renderText(s);
  await transport.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to: EMAIL_TO,
    subject,
    text,
    html,
  });
  console.log(`✔ Email sent to ${EMAIL_TO}`);
}

async function sendPush(s: Summary) {
  const { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS } = process.env;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !PUSH_SUBSCRIPTIONS) {
    console.log("📱 Web push not configured (VAPID_* / PUSH_SUBSCRIPTIONS missing) — skipping.");
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:alerts@example.com", VAPID_PUBLIC, VAPID_PRIVATE);

  let subs: unknown;
  try {
    subs = JSON.parse(PUSH_SUBSCRIPTIONS);
  } catch {
    console.log("📱 PUSH_SUBSCRIPTIONS is not valid JSON — skipping.");
    return;
  }
  const list = Array.isArray(subs) ? subs : [subs];
  const { subject } = renderText(s);
  const payload = JSON.stringify({
    title: subject,
    body: s.topIdea ? `${s.topIdea.contract} — entry ${s.topIdea.entry}` : s.headline,
    tag: s.session,
  });

  let ok = 0;
  for (const sub of list) {
    try {
      await webpush.sendNotification(sub as webpush.PushSubscription, payload);
      ok++;
    } catch (e) {
      console.warn("push failed for one subscription:", (e as Error).message);
    }
  }
  console.log(`✔ Web push sent to ${ok}/${list.length} device(s).`);
}

async function main() {
  const s = load();
  if (!s) {
    console.log("No summary found — run a scan first.");
    return;
  }
  await Promise.allSettled([sendEmail(s), sendPush(s)]);
  console.log("✅ Notifications dispatched.");
}

main().catch((e) => {
  console.error("Notify failed:", e);
  process.exit(0); // never fail the workflow over notifications
});
