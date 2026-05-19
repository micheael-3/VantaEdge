# VantaEdge

AI-powered football goals prediction platform. Covers MLS, Bundesliga, Eredivisie, Championship, Ligue 1, Scottish Premiership, La Liga, and Premier League.

- **Frontend**: React + Vite (deployed to Netlify)
- **Backend**: Node.js + Express + Prisma (deployed to Railway)
- **Database**: PostgreSQL
- **Auth**: JWT in httpOnly cookies (access 15min, refresh 7d)
- **Payments / Entitlements**: RevenueCat (webhook-driven tier updates)
- **Match data**: API-Football via RapidAPI
- **AI analysis**: OpenRouter (`meta-llama/llama-3.1-8b-instruct` by default)

---

## Project Structure

```
VantaEdge/
├── backend/                Express API + Prisma + services
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── routes/         auth, predictions, history, user, webhook
│   │   ├── middleware/     auth, tierGate, refreshLimit
│   │   ├── services/       football, claude, ev, cache
│   │   └── prisma/         prisma client wrapper
│   ├── server.js
│   ├── package.json
│   ├── railway.json
│   └── .env.example
└── frontend/               React + Vite SPA
    ├── src/
    │   ├── pages/          Landing, Login, Register, Dashboard, History, Settings
    │   ├── components/     Navbar, MatchCard, LeagueTabs, ConfidenceBar, EVBadge,
    │   │                   KellyStake, FormDots, SkeletonCard, TierGate,
    │   │                   UpgradeModal, CSVExport
    │   ├── context/AuthContext.jsx
    │   ├── api/client.js
    │   ├── config/leagues.js
    │   ├── lib/ev.js
    │   ├── App.jsx
    │   └── main.jsx
    ├── index.html
    ├── vite.config.js
    ├── netlify.toml
    └── .env.example
```

---

## Tier Matrix

| Feature                  | FREE      | SCOUT     | ANALYST   | EDGE      |
| ------------------------ | --------- | --------- | --------- | --------- |
| Leagues                  | 3 (view)  | 3         | 7         | 8         |
| Daily refreshes          | 0         | 3         | 10        | Unlimited |
| Over / BTTS predictions  | yes       | yes       | yes       | yes       |
| AI reasoning             | gated     | gated     | yes       | yes       |
| +EV calculator & Kelly   | gated     | gated     | yes       | yes       |
| 30-day history dashboard | —         | —         | yes       | yes       |
| First-half + Asian H/C   | gated     | gated     | gated     | yes       |
| All-time accuracy        | —         | —         | —         | yes       |
| CSV export               | —         | —         | —         | yes       |

Tier gates are enforced **server-side** on every endpoint. The frontend mirrors them only for UX (blur overlays via `TierGate`).

---

## Local Setup

### 1. Clone

```bash
git clone <your-repo-url> VantaEdge
cd VantaEdge
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in all values in .env — see "Environment Variables" below
npm install
npx prisma migrate dev --name init
node server.js
```

The API listens on `http://localhost:4000`. A health check is available at `GET /health`.

### 3. Frontend

In a separate terminal:

```bash
cd frontend
cp .env.example .env
# .env should contain: VITE_API_URL=http://localhost:4000
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api/*` to the backend.

---

## Environment Variables

### `backend/.env`

| Variable                    | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection string                                      |
| `JWT_SECRET`                | Long random string for signing access tokens                      |
| `JWT_REFRESH_SECRET`        | Different long random string for refresh tokens                   |
| `FOOTBALL_API_KEY`          | API-Football direct key from dashboard.api-football.com           |
| `OPENROUTER_API_KEY`        | OpenRouter API key (`sk-or-...`) from openrouter.ai/keys          |
| `REVENUECAT_WEBHOOK_SECRET` | Webhook auth header value set in the RevenueCat dashboard         |
| `FRONTEND_URL`              | Origin for CORS, e.g. `http://localhost:5173` or your Netlify URL |
| `PORT`                      | Backend port (default `4000`)                                     |
| `NODE_ENV`                  | `development` locally, `production` on Railway                    |

### `frontend/.env`

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `VITE_API_URL` | Full URL of the backend (no trailing slash)              |

---

## Deploy

### Backend — Railway

1. Create a new Railway project.
2. Add the **PostgreSQL** plugin. Copy the `DATABASE_URL` it provides into the service's environment variables.
3. Add the rest of the backend env vars (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `FOOTBALL_API_KEY`, `OPENROUTER_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `FRONTEND_URL`, `NODE_ENV=production`).
4. Point the Railway service at the `backend/` folder. The included `railway.json` runs:
   ```
   npx prisma migrate deploy && node server.js
   ```
5. Note the public Railway URL — you'll need it for the frontend and for the RevenueCat webhook.

### Frontend — Netlify

1. Connect the GitHub repo.
2. Set base directory: `frontend`
3. Build command: `npm run build`
4. Publish directory: `frontend/dist` (or `dist` if base is set to `frontend`)
5. In **Site settings → Environment variables**, set `VITE_API_URL` to the Railway URL.
6. Deploy. `netlify.toml` already includes the SPA `/*` → `/index.html` rewrite.

### RevenueCat Setup

1. Create the app in the RevenueCat dashboard.
2. Add monthly products with these exact identifiers:
   - `vantaedge_scout_monthly`
   - `vantaedge_analyst_monthly`
   - `vantaedge_edge_monthly`
3. Configure attached entitlements so RevenueCat reports the product id in webhook events.
4. In **Integrations → Webhooks**, point the webhook at:
   ```
   https://<your-railway-url>/api/webhook/revenuecat
   ```
5. Set the Authorization header to a strong secret and copy it into `REVENUECAT_WEBHOOK_SECRET` on Railway.

The webhook handles `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION`, `CANCELLATION`, and `EXPIRATION`. Users are matched via `app_user_id` (against `User.revenuecatId`) or, as a fallback, by email if `app_user_id` looks like an email.

---

## API Keys Required

- **API-Football** — register at [dashboard.api-football.com](https://dashboard.api-football.com) and copy your `x-apisports-key`
- **OpenRouter** — create a key at [openrouter.ai/keys](https://openrouter.ai/keys). The default model is `meta-llama/llama-3.1-8b-instruct` (cheap, fast); change `MODEL` in `backend/src/services/claude.js` if you want something stronger.
- **RevenueCat** — webhook secret from the dashboard

---

## API Reference (summary)

All endpoints prefixed `/api`. Cookies are set/read automatically — clients must use `withCredentials: true`.

| Method | Path                              | Auth | Notes                                                      |
| ------ | --------------------------------- | ---- | ---------------------------------------------------------- |
| POST   | `/auth/register`                  | —    | Creates user (FREE tier), sets cookies                     |
| POST   | `/auth/login`                     | —    | Validates credentials, sets cookies                        |
| POST   | `/auth/refresh`                   | —    | Rotates refresh token, sets new cookies                    |
| POST   | `/auth/logout`                    | yes  | Clears cookies and DB refresh token                        |
| GET    | `/auth/me`                        | yes  | Returns current user                                       |
| GET    | `/predictions/:leagueId`          | yes  | Returns today's fixtures + AI predictions (tier-gated)     |
| GET    | `/history`                        | yes  | ANALYST+ — accuracy summary, rolling chart, recent picks   |
| GET    | `/history/accuracy`               | yes  | ANALYST+ — raw `PredictionHistory` rows                    |
| POST   | `/user/email`                     | yes  | Update email (requires current password)                   |
| POST   | `/user/password`                  | yes  | Update password (revokes refresh token)                    |
| DELETE | `/user`                           | yes  | Delete account (requires password)                         |
| POST   | `/webhook/revenuecat`             | sig  | RevenueCat events update `User.tier`                       |

---

## Notes / Future Work

- A scheduled job (e.g. a Railway cron) should backfill `Prediction.overHit` / `bttsHit` once final scores are available, and write `PredictionHistory` rows for the chart.
- The `Subscribe` buttons in `UpgradeModal` currently point at `#`. Replace with your RevenueCat web paywall URLs.
- For production, set `NODE_ENV=production` so auth cookies are issued with `SameSite=None; Secure`.
- The Vite build emits a single ~626 KB JS bundle. Use `build.rollupOptions.output.manualChunks` if you want code splitting.
