# 🚀 Deploy Option Oracle

## Option A — Vercel (dynamic, recommended) ⚡

A serverless function (`api/scan.ts`) fetches **live data on every visit**, server-side,
with your key hidden — no twice-daily limit, no key in the browser. Results are cached ~5
min so visitors share one fetch (well under Finnhub's 60/min).

1. Push the repo to GitHub (see Option B step 1 if you haven't).
2. Go to **https://vercel.com → Add New → Project → Import** your `optiontracker` repo.
   Framework preset auto-detects **Vite** (build `npm run build`, output `dist`). Click Deploy.
3. **Project → Settings → Environment Variables** → add `FINNHUB_API_KEY` = your key →
   **Redeploy**. That's it — the site is live and dynamic at `https://<project>.vercel.app`,
   works from your phone (installable PWA).

The frontend calls `/api/scan` automatically; if it's ever unavailable it falls back to the
committed reports, so nothing breaks. Test the endpoint directly at
`https://<project>.vercel.app/api/scan?session=morning`.

> **Notifications + history ledger:** the on-demand API doesn't write history or send alerts.
> Keep the **GitHub Actions cron** (Option B) running in the same repo for the 9 AM / 9 PM
> email/push notifications and the `history.json` performance ledger — it works alongside
> Vercel. (Add the same secrets there.) Or wire Vercel Cron later.

> Local dev with the function: `npm i -g vercel` then `vercel dev` (plain `npm run dev`
> can't run serverless functions, so it uses the static-report fallback).

---

## Option B — GitHub Pages (static, free)

This gets the app live on **GitHub Pages** with live Finnhub data, automatic
**9 AM / 9 PM** scans, and **email + push** alerts to your phone — all on free tiers,
no server to run.

```
Phone (PWA) ──reads──▶ GitHub Pages (static site + public/data/*.json)
                                  ▲ commits 2×/day
                    GitHub Actions cron ── Finnhub ── engines ── email + web push
```

---

## 1. Push the code to GitHub

```bash
cd "option tracker"
git init
git add -A
git commit -m "Option Oracle"
gh repo create option-tracker --public --source=. --push
# or: create the repo on github.com and `git remote add origin … && git push -u origin main`
```

## 2. Turn on GitHub Pages
Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The first push triggers **Deploy to GitHub Pages**. Your site will be at:
`https://<your-username>.github.io/option-tracker/`

> It works immediately even before you add any keys — it falls back to in-browser
> sample data. Add the keys below to make it live.

## 3. Get your free API key (live data)
1. Sign up at **https://finnhub.io** → copy your API key.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `FINNHUB_API_KEY` = your key

That alone makes the scheduled scans use **live quotes, news, earnings & analyst trends**.

## 4. Email alerts (recommended — easiest)
Use any SMTP. For Gmail: enable 2FA, then create an **App Password**
(Google Account → Security → App passwords). Add these secrets:

| Secret | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `you@gmail.com` |
| `SMTP_PASS` | the 16-char app password |
| `EMAIL_FROM` | `you@gmail.com` |
| `EMAIL_TO` | `you@gmail.com` (where alerts go) |

(Or use Resend / SendGrid / Mailgun SMTP — same fields.)

## 5. Phone push alerts (optional)
1. Generate VAPID keys locally:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Add secrets:
   - `VAPID_PUBLIC` = the public key
   - `VAPID_PRIVATE` = the private key
   - `VAPID_SUBJECT` = `mailto:you@example.com`
3. Re-deploy so the site is built with the public key (push any commit, or run the
   **Deploy** workflow manually). The public key is injected at build time as
   `VITE_VAPID_PUBLIC`.

   > Add it as a **repository variable or secret** named `VAPID_PUBLIC` — the deploy
   > workflow already reads `secrets.VAPID_PUBLIC` for the build.
4. On your **phone**: open the site in Chrome/Safari → **Share → Add to Home Screen**.
   Open the installed app → **Alerts & Setup → Enable phone alerts** → **Copy token**.
5. Paste that token into a new secret `PUSH_SUBSCRIPTIONS`
   (for several devices, make it a JSON array: `[ {sub1}, {sub2} ]`).

## 6. Verify the schedule
Repo **Actions → Scheduled Market Scan → Run workflow** (pick `morning` or `evening`)
to test immediately. It will fetch data, generate the report, email/push you, commit
`public/data/*`, and redeploy.

The crons run automatically:
- `0 13 * * 1-5` → ~9:00 AM ET (morning prep, weekdays)
- `0 1 * * 2-6` → ~9:00 PM ET (evening recap)

> ⏰ GitHub cron is UTC and doesn't follow daylight saving. During EST (winter) these
> fire ~1h earlier (8 AM / 8 PM ET). The runner classifies morning vs evening from the
> real Eastern-time hour, so reports stay correct. Adjust the cron lines if you want
> exact times year-round.

---

## Secrets summary

| Secret | Needed for | Required? |
|---|---|---|
| `FINNHUB_API_KEY` | live market data | for live mode |
| `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`, `EMAIL_TO` | email alerts | optional |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` | web push | optional |
| `PUSH_SUBSCRIPTIONS` | web push target device(s) | optional |

Everything optional degrades gracefully — missing a channel just skips it; missing a key
falls back to sample data. Nothing crashes.

---

## Run it locally

```bash
npm install
npm run dev                       # http://localhost:5173 (in-browser sample data)

# generate real reports locally (needs the key in your shell):
FINNHUB_API_KEY=xxxx npm run scan -- --session=morning
npm run dev                       # now shows the live report you just generated
```

On Windows PowerShell: `$env:FINNHUB_API_KEY="xxxx"; npm run scan -- --session=morning`

---

## Want true real-time + a real Postgres backend later?
The analysis engines and the `MarketDataProvider` interface are server-ready. To move
off the serverless model: run `scripts/runScan.ts` on a cron in a Node service, swap the
file-based `public/data` store for Postgres, and add a WebSocket feed. The frontend and
engines don't change. See **README.md → Production backend path**.
