# 🔮 Option Oracle — AI Options Trading Assistant

A modern, AI-style market & options trading desk that scans the U.S. market, scores
high-conviction options setups, and produces structured **9:00 AM market-prep** and
**9:00 PM market-recap** reports.

> ⚠️ **Educational analysis only — not financial advice.** Options can lose 100% of the
> premium paid. Every recommendation ships with risk level, max loss, stop, invalidation,
> and reasons the trade could fail.

---

## What's in this build

A **runnable, end-to-end app** with real analysis engines, **live Finnhub data**, a
**serverless backend** (GitHub Actions), a **file-based DB**, **scheduled 9 AM / 9 PM
scans**, and **email + web-push notifications** — deployable free to GitHub Pages and
installable on your phone as a PWA. It still falls back to in-browser sample data when no
keys are configured, so it runs instantly out of the box.

👉 **Deploy guide: [SETUP.md](SETUP.md)** (GitHub Pages + Finnhub key + alerts, all free tier).

### How live mode works (serverless)
```
Phone (PWA on GitHub Pages) ──reads──▶ public/data/*.json   ← the file-based DB
                                              ▲ commits 2×/day
        GitHub Actions cron (9AM/9PM ET)
          ├─ FinnhubProvider ........ live quotes, news, earnings, analyst trends
          ├─ engines ................ report + history.json (recommendation ledger)
          └─ notify ................. email (SMTP) + web push (VAPID) to your phone
```
The Finnhub key lives only in GitHub Secrets and is used inside the Action — it is **never
shipped to the browser**. The browser only reads the committed JSON reports.

**Live vs derived (Finnhub free tier):** quotes, news, earnings and analyst trends are
**live**; technicals and news sentiment are **derived** from live price/returns; options
chains, IV and flow are **modeled** (no free options data — swap in Polygon/Tradier for
real chains via the same interface). The app labels this in **Alerts & Setup → Data & Status**.

### Working today
- **Two daily scans** — 9 AM Prep / 9 PM Recap, toggleable in the header, each producing a
  full structured report.
- **Market Sentiment Engine** — composite −100…+100 score from index trend, futures, VIX,
  breadth, yields, dollar, sector rotation and news; classifies the tape (Strong Bullish →
  Strong Bearish) and recommends the environment (calls / puts / spreads / straddles /
  watch / cash).
- **Conviction Engine** — weighted 1–10 score using the exact spec weights:
  catalyst 20%, technical 20%, liquidity 15%, market-alignment 15%, sector 10%,
  risk/reward 10%, news quality 5%, volatility 5%.
- **Options selection engine** — picks a liquid, ~0.40-delta, 2–6-week contract from a
  synthetic chain; rejects wide spreads / thin OI / low volume; computes entry, target,
  stop, prob-of-profit, expected move and max loss.
- **Technical engine** — VWAP, MA stack (20/50/200), RSI, MACD, relative strength,
  relative volume, breakout/breakdown proximity → 0–10 score + plain-English read.
- **Catalyst / news / analyst** scoring, **earnings module** with implied-move &
  IV-crush warnings, **unusual options flow**, sector heatmap, top movers.
- **Full report view** — narrative, drivers, strongest/weakest sectors, bullish & bearish
  setups, earnings to watch, key levels, numbered game plan, highest-conviction trade,
  best call & best put, risk warning.
- **UI** — dark, card-based, responsive dashboard; conviction dials; expandable thesis
  cards; sentiment gauge; watchlists; saved ideas; trade journal (with win-rate);
  alert banners. State persists to `localStorage`.

---

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

Requires Node 18+.

---

## Architecture

```
src/
  types/            Domain model (quotes, chains, ideas, reports …)
  data/
    provider.ts        MarketDataProvider interface + registry  ← the only seam to data
    mockProvider.ts    Deterministic sample data (offline / fallback)
    finnhubProvider.ts LIVE provider — quotes/news/earnings/analyst from Finnhub (Node)
    universe.ts        Shared ticker list, sector ETFs, macro proxies
  engines/          Pure, backend-ready analysis modules (no React):
    technical.ts      → 0–10 technical read
    options.ts        → liquidity scoring + contract selection
    conviction.ts     → catalyst scoring + weighted 1–10 trade idea
    sentiment.ts      → composite market sentiment + environment bias
    report.ts         → runScan(): assembles the full morning/evening report
  components/       React UI (dashboard, report, flow, earnings, watchlists, journal,
                    notification setup / data status)
  store.tsx         App state — reads public/data/*.json (live), mock fallback
scripts/            The serverless "backend" (run by GitHub Actions or locally):
  runScan.ts        fetch live snapshot → run engines → write reports + history.json
  notify.ts         email (SMTP) + web push (VAPID) from the latest summary
  trackOutcomes.ts  backfill 1d/3d/1w P/L on past recommendations (performance tracking)
public/
  data/*.json       the file-based DB: latest-*, history, status, last-summary
  sw.js, manifest   PWA service worker + manifest (install + push on phone)
.github/workflows/
  scan.yml          cron 9AM/9PM ET → scan + notify + commit + deploy
  deploy.yml        build + deploy to GitHub Pages on code push
```

The engines are **framework-free pure functions** — they run unchanged in a Node/Express
or NestJS backend, a cron worker, or a serverless function.

### Plugging in real data

Implement `MarketDataProvider` against your vendor and register it in `src/store.tsx`:

```ts
// src/data/polygonProvider.ts
export class PolygonProvider implements MarketDataProvider {
  readonly id = "polygon";
  async getSnapshot(session) { /* fetch quotes, indices, news, chains … */ }
  async getOptionChain(ticker) { /* GET /v3/snapshot/options/{ticker} */ }
}

// src/store.tsx
registerProvider(new PolygonProvider());   // ← swap MockProvider for this
```

Everything downstream (engines, UI, reports) is provider-agnostic. Suggested vendors:
Polygon.io / Tradier / Alpaca (prices + chains), Finnhub / Benzinga (news + analyst),
Financial Modeling Prep (earnings + fundamentals), FRED (macro), SEC EDGAR (filings),
Unusual Whales / CBOE (flow).

---

## Production backend path (next steps)

The frontend is structured so the analysis layer lifts straight into a service:

1. **Scheduler** — cron / BullMQ / Celery jobs at `09:00` and `21:00` ET call
   `runScan(snapshot, type)` and persist the result.
2. **Persistence** — PostgreSQL tables for users, watchlists, tickers, price/chain
   snapshots, earnings, news, analyst actions, **recommendations** (with spot & premium
   at rec time), conviction scores, alerts, journal, and **performance tracking**
   (outcome after 1d / 3d / 1w / expiry). Redis for hot quote/chain caching.
3. **API** — expose REST/GraphQL: `GET /report/:session`, `GET /ideas`, `POST /watchlist`,
   `GET /flow`, WebSocket channel for live quotes & alert pushes.
4. **Notifications** — fan out alerts (report ready, breakout/breakdown, UOA, earnings,
   rating change, invalidation hit, IV too high, sentiment shift) to in-app / email /
   push / SMS.
5. **AI narratives** — the report engine already produces structured data + templated
   prose; pipe `MarketReport` into Claude for richer natural-language write-ups while
   keeping the deterministic scores as ground truth.

### Later (designed for, not yet built)
Paper trading · broker integration · backtesting · AI chatbot · portfolio risk ·
strategy builder · multi-leg spreads · earnings-prediction model · live UOA dashboard ·
whale tracking · social sentiment (Reddit/X/Stocktwits) · per-ticker custom alerts ·
risk-tolerance profiles · performance leaderboard · native mobile.

---

## Conviction scoring model

`score = Σ factorᵢ × weightᵢ`, each factor 0–10:

| Factor | Weight | Source |
|---|---|---|
| Catalyst strength | 20% | news + analyst impact/sentiment |
| Technical setup | 20% | trend, MA stack, RSI, MACD, RS, levels |
| Options liquidity | 15% | spread, open interest, volume |
| Market alignment | 15% | SPY/QQQ trend, breadth, VIX |
| Sector strength | 10% | sector relative strength vs SPY |
| Risk/reward | 10% | target vs stop on the contract |
| News quality | 5% | source impact tier |
| Volatility conditions | 5% | IV rank (penalizes expensive premium) |

**9–10** very strong · **7–8** good w/ risk · **5–6** watchlist · **<5** avoid.

---

*Built as a foundation — modular by design so data providers, the backend, and the
feature roadmap can be layered on without touching the analysis core.*
