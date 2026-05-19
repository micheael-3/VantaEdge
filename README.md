# VantaEdge

AI-powered football goals prediction platform. Covers MLS, Bundesliga, Eredivisie, Championship, Ligue 1, Scottish Premiership, La Liga, and Premier League.

**Architecture:**

- **Frontend**: React + Vite, builds to `frontend/dist`
- **Backend**: Netlify Functions (`netlify/functions/*`) — no separate server
- **Database**: Neon Postgres (free tier, browser-only setup)
- **Auth**: JWT in `HttpOnly` cookies (access 15 min, refresh 7 d, same-origin)
- **Payments / Entitlements**: RevenueCat (webhook-driven tier updates)
- **Match data**: API-Football (direct, `x-apisports-key`)
- **AI analysis**: OpenRouter (`meta-llama/llama-3.1-8b-instruct` by default)

**Deploy in one go**: connect this repo to Netlify, paste 7 env vars, done. Step-by-step in [NETLIFY-DEPLOY.md](NETLIFY-DEPLOY.md).

---

## Repo layout

```
VantaEdge/
├── netlify.toml             # build config + /api/* → functions redirects
├── schema.sql               # one-time paste into Neon SQL editor
├── package.json             # function deps (pg / bcrypt / jwt / cookie / axios)
├── netlify/functions/
│   ├── _shared/             # db, cookies, jwt, football, claude, ev, tier, refresh-limit, cache, response
│   ├── auth.js              # POST /register, /login, /refresh, /logout, GET /me
│   ├── predictions.js       # GET /:leagueId (8 leagues, tier-gated)
│   ├── history.js           # GET /, /accuracy (ANALYST+)
│   ├── user.js              # POST /email, /password, DELETE /
│   └── webhook.js           # POST /revenuecat
└── frontend/
    ├── package.json
    ├── vite.config.js
    └── src/                 # pages, components, AuthContext, API client
```

---

## Tier matrix

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

Tier gates are enforced **inside each function**. The frontend mirrors them only for UX (blur overlays via `TierGate`).

---

## API surface

All endpoints are `/api/*` from the browser. `netlify.toml` rewrites them to `/.netlify/functions/<name>/<sub-path>` at the edge — no CORS, cookies sent automatically.

| Method | Path                              | Auth | Notes                                                      |
| ------ | --------------------------------- | ---- | ---------------------------------------------------------- |
| POST   | `/api/auth/register`              | —    | Creates user (FREE tier), sets cookies                     |
| POST   | `/api/auth/login`                 | —    | Validates credentials, sets cookies                        |
| POST   | `/api/auth/refresh`               | —    | Rotates refresh token, sets new cookies                    |
| POST   | `/api/auth/logout`                | yes  | Clears cookies and DB refresh token                        |
| GET    | `/api/auth/me`                    | yes  | Returns current user                                       |
| GET    | `/api/predictions/:leagueId`      | yes  | Today's fixtures + AI predictions (tier-gated)             |
| GET    | `/api/history`                    | yes  | ANALYST+ — summary, rolling chart, recent picks            |
| GET    | `/api/history/accuracy`           | yes  | ANALYST+ — raw `prediction_history` rows                   |
| POST   | `/api/user/email`                 | yes  | Update email (requires current password)                   |
| POST   | `/api/user/password`              | yes  | Update password (revokes refresh token)                    |
| DELETE | `/api/user`                       | yes  | Delete account (requires password)                         |
| POST   | `/api/webhook/revenuecat`         | sig  | RevenueCat events update `users.tier`                      |
| POST   | `/api/admin/login`                | adm  | Verifies `ADMIN_PASSWORD` bearer header                    |
| GET    | `/api/admin/users`                | adm  | All users + their prediction counts                        |
| GET    | `/api/admin/predictions`          | adm  | All predictions created today                              |
| GET    | `/api/admin/stats`                | adm  | Totals + per-league counts                                 |

---

## Environment variables

All on the Netlify site (one place). See [NETLIFY-DEPLOY.md](NETLIFY-DEPLOY.md) for full instructions.

| Variable                    | Source                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`              | Neon **pooled** connection string                                   |
| `JWT_SECRET`                | 128-char random hex                                                 |
| `JWT_REFRESH_SECRET`        | Different 128-char random hex                                       |
| `FOOTBALL_API_KEY`          | dashboard.api-football.com                                          |
| `OPENROUTER_API_KEY`        | openrouter.ai/keys                                                  |
| `REVENUECAT_WEBHOOK_SECRET` | Random string, also pasted into RevenueCat webhook header           |
| `ADMIN_PASSWORD`            | Password for `/admin` panel. Pick a strong one — it's the only credential for the admin UI. |
| `NODE_ENV`                  | any value other than `development` (controls `Secure` cookie flag)  |

`URL` is set automatically by Netlify (used for the OpenRouter `HTTP-Referer` header).

---

## Local development (optional)

The frontend runs standalone if you point it at a deployed Netlify URL:

```bash
cd frontend
npm install
VITE_DEV_PROXY=https://<your-site>.netlify.app npm run dev
```

For full local stack (frontend + functions), install Netlify CLI and run `netlify dev` at the repo root. The functions need `DATABASE_URL` exported in your shell pointing at Neon.

---

## Notes / future work

- A scheduled function (Netlify Scheduled Functions) should backfill `predictions.over_hit` / `btts_hit` once final scores are available, and roll up `prediction_history` rows for the chart.
- The `Subscribe` buttons in `UpgradeModal` currently point at `#`. Swap in your RevenueCat web-paywall URLs.
- In-process cache in `_shared/cache.js` only survives within a single warm function instance. For higher hit-rate, swap to Upstash Redis (free tier, also HTTP-friendly).
