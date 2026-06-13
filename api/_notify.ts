import nodemailer from "nodemailer";
import webpush from "web-push";

// ============================================================================
// Shared notification logic (email + web push). Used by both the Vercel cron
// endpoint (api/cron.ts) and the local/GitHub-Actions script (scripts/notify.ts).
// Files prefixed with "_" are not treated as routes by Vercel.
//
// All credentials come from env vars; a channel with missing config is skipped.
// ============================================================================

export interface NotifySummary {
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

export function renderText(s: NotifySummary): { subject: string; text: string; html: string } {
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

export async function sendEmail(s: NotifySummary): Promise<string> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_TO) {
    return "email: not configured (skipped)";
  }
  const port = parseInt(SMTP_PORT || "465", 10);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const { subject, text, html } = renderText(s);
  await transport.sendMail({ from: EMAIL_FROM || SMTP_USER, to: EMAIL_TO, subject, text, html });
  return `email: sent to ${EMAIL_TO}`;
}

export async function sendPush(s: NotifySummary): Promise<string> {
  const { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS } = process.env;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !PUSH_SUBSCRIPTIONS) {
    return "push: not configured (skipped)";
  }
  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:alerts@example.com", VAPID_PUBLIC, VAPID_PRIVATE);
  let subs: unknown;
  try {
    subs = JSON.parse(PUSH_SUBSCRIPTIONS);
  } catch {
    return "push: PUSH_SUBSCRIPTIONS not valid JSON (skipped)";
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
  return `push: sent to ${ok}/${list.length} device(s)`;
}

export async function sendNotifications(s: NotifySummary): Promise<string[]> {
  const results = await Promise.allSettled([sendEmail(s), sendPush(s)]);
  return results.map((r) => (r.status === "fulfilled" ? r.value : `error: ${r.reason}`));
}
