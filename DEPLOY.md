# VantaEdge — Railway Deployment Guide

This deploys **two Railway services from one repo**:

| Service              | Root directory | Public domain you'll generate                | Purpose                  |
| -------------------- | -------------- | -------------------------------------------- | ------------------------ |
| `vantaedge-backend`  | `backend/`     | e.g. `vantaedge-backend-production.up.railway.app`  | API + Prisma + Postgres  |
| `vantaedge-frontend` | `frontend/`    | e.g. `vantaedge-frontend-production.up.railway.app` | React SPA served by `serve` |

Both services pull from the **same GitHub repo** — Railway uses the **Root Directory** setting to know which folder to build.

---

## 0. Prerequisites (one-time)

1. Push the entire `VantaEdge/` folder to a GitHub repo (private is fine).
2. Sign in at <https://railway.com> with GitHub.
3. Click **Authorize Railway** for the repo (or grant org access).

---

## 1. Create the project

1. From the Railway dashboard click **New Project** (top-right).
2. Choose **Deploy from GitHub repo**.
3. Pick your `VantaEdge` repo.
4. Railway will create a project with one service auto-named after the repo. **Delete that auto-created service** — we'll add ours explicitly:
   - Click the service tile → **Settings** (right panel) → scroll to bottom → **Delete Service** → confirm.

You should now see an empty project canvas with just the project name at the top.

---

## 2. Add the Postgres database

1. On the project canvas click **+ Create** (or **New** button, top-right of the canvas).
2. Choose **Database → Add PostgreSQL**.
3. Railway provisions a Postgres instance. Click its tile.
4. Go to the **Variables** tab — confirm `DATABASE_URL` exists. You'll reference it from the backend in a minute.

---

## 3. Deploy the backend service

### 3a. Create the service

1. On the project canvas click **+ Create → GitHub Repo**.
2. Pick the same `VantaEdge` repo.
3. After it appears, click the new service tile.
4. Open **Settings** (right side panel).
5. Under **Source**:
   - **Root Directory** → paste exactly: `backend`
   - **Watch Paths** (optional, recommended) → `backend/**`
6. Under **Service Name** → rename to `vantaedge-backend`.

### 3b. Build & deploy commands

The repo already contains `backend/railway.json` so Railway will auto-pick:

- **Build command**: `npm install && npx prisma generate`
- **Start command**: `npx prisma migrate deploy && node server.js`
- **Healthcheck**: `/health`

If for any reason you want to override in the UI (Settings → **Deploy** section):
- **Custom Start Command** field → paste: `npx prisma migrate deploy && node server.js`
- **Healthcheck Path** → `/health`

### 3c. Add the public domain

1. In the backend service open **Settings → Networking**.
2. Click **Generate Domain**.
3. Railway gives you something like `vantaedge-backend-production.up.railway.app`.
4. **Copy this URL** — you need it for the frontend's `VITE_API_URL` and the frontend's URL goes back into `FRONTEND_URL` after step 4.

### 3d. Backend environment variables

Open the backend service → **Variables** tab → click **+ New Variable** (or **Raw Editor** to paste all at once).

Add **every** variable below. The exact key on the left is what to type into the **NAME** field; the right column is what goes into the **VALUE** field.

| NAME                        | VALUE                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Click **Add Reference** instead of typing → pick **Postgres → DATABASE_URL**. This auto-links the two services. |
| `JWT_SECRET`                | A long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET`        | Another long random string (different from `JWT_SECRET`). Same `node` command, run again.                   |
| `FOOTBALL_API_KEY`          | Your `x-apisports-key` from <https://dashboard.api-football.com>                                            |
| `OPENROUTER_API_KEY`        | Your OpenRouter key starting with `sk-or-…` from <https://openrouter.ai/keys>                               |
| `REVENUECAT_WEBHOOK_SECRET` | A strong random string you'll also paste into the RevenueCat webhook **Authorization header** field         |
| `FRONTEND_URL`              | The frontend Railway URL with `https://` prefix, **no trailing slash**. You'll fill this in after step 4.   |
| `NODE_ENV`                  | `production`                                                                                                |
| `PORT`                      | **Don't add this** — Railway sets it automatically, and `server.js` reads it via `process.env.PORT`.        |

Click **Deploy** (top-right of the service panel) after saving variables. Watch the **Deployments** tab — the build should succeed; the first deploy runs `prisma migrate deploy` which creates all tables.

### 3e. Verify

In your browser open: `https://<your-backend-domain>/health` — you should see `{"ok":true,"ts":…}`.

---

## 4. Deploy the frontend service

### 4a. Create the service

1. Back on the project canvas click **+ Create → GitHub Repo**.
2. Pick the same `VantaEdge` repo again.
3. Click the new service tile → **Settings**.
4. Under **Source**:
   - **Root Directory** → paste exactly: `frontend`
   - **Watch Paths** → `frontend/**`
5. **Service Name** → rename to `vantaedge-frontend`.

### 4b. Build & start commands

The repo contains `frontend/railway.json`, so Railway auto-picks:

- **Build command**: `npm run build`
- **Start command**: `npx serve -s dist -l tcp://0.0.0.0:$PORT`
- **Healthcheck**: `/`

If you want to override in the UI (Settings → **Deploy**):
- **Custom Build Command** field → paste: `npm run build`
- **Custom Start Command** field → paste: `npx serve -s dist -l tcp://0.0.0.0:$PORT`

The `-s` flag is critical — it tells `serve` to rewrite all unknown paths to `index.html` so React Router's `/dashboard`, `/history`, etc. work on hard refresh.

### 4c. Frontend environment variable

Open the frontend service → **Variables** tab → **+ New Variable**:

| NAME           | VALUE                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| `VITE_API_URL` | Your backend Railway URL from step 3c, with `https://` prefix, **no trailing slash** |

Example: `VITE_API_URL=https://vantaedge-backend-production.up.railway.app`

Vite inlines this at **build time**, so any time you change it you must **redeploy** the frontend (Deployments tab → ⋯ → **Redeploy**) — restarting alone is not enough.

### 4d. Generate the frontend domain

1. Frontend service → **Settings → Networking → Generate Domain**.
2. Copy the URL (e.g. `vantaedge-frontend-production.up.railway.app`).

### 4e. Finish the round-trip

1. Go back to the **backend** service → **Variables**.
2. Set `FRONTEND_URL` to `https://<your-frontend-domain>` (with `https://`, no trailing slash).
3. The backend will auto-redeploy. This is required for:
   - **CORS** — `cors({ origin: FRONTEND_URL, credentials: true })`
   - **Cookies** — when `NODE_ENV=production`, auth cookies are issued with `SameSite=None; Secure` and the browser will only send them on requests from this exact origin.

---

## 5. Configure RevenueCat (optional but required for paid tiers)

1. RevenueCat dashboard → **Integrations → Webhooks → New Webhook**.
2. **URL**: `https://<your-backend-domain>/api/webhook/revenuecat`
3. **Authorization header value**: paste the same string you used for `REVENUECAT_WEBHOOK_SECRET` on Railway.
4. In **Products** add monthly entitlements with **exactly** these identifiers (the backend maps on them):
   - `vantaedge_scout_monthly`
   - `vantaedge_analyst_monthly`
   - `vantaedge_edge_monthly`

---

## 6. Smoke test

1. Open the frontend URL.
2. Click **Start Free** → register → you should land on `/dashboard`.
3. Open browser DevTools → **Application → Cookies** for the frontend domain — you should see `accessToken` and `refreshToken` (both `HttpOnly`, `Secure`, `SameSite=None`).
4. Pick a SCOUT-tier league tab — fixtures should load (or "No matches today" if there are no games).
5. In RevenueCat send a test `INITIAL_PURCHASE` event with `app_user_id` = the email you registered with. Reload `/dashboard` — the tier badge in the navbar should update.

---

## Recap of every Railway environment variable

### Backend service (`vantaedge-backend`)

| NAME                        | Required | Source                                              |
| --------------------------- | -------- | --------------------------------------------------- |
| `DATABASE_URL`              | yes      | Reference → Postgres service                        |
| `JWT_SECRET`                | yes      | Random 64-byte hex                                  |
| `JWT_REFRESH_SECRET`        | yes      | Random 64-byte hex (different)                      |
| `FOOTBALL_API_KEY`          | yes      | dashboard.api-football.com                          |
| `OPENROUTER_API_KEY`        | yes      | openrouter.ai/keys                                  |
| `REVENUECAT_WEBHOOK_SECRET` | yes      | Random string, also pasted into RevenueCat webhook  |
| `FRONTEND_URL`              | yes      | `https://<frontend-railway-domain>` (set in step 4e) |
| `NODE_ENV`                  | yes      | `production`                                        |

### Frontend service (`vantaedge-frontend`)

| NAME           | Required | Source                                             |
| -------------- | -------- | -------------------------------------------------- |
| `VITE_API_URL` | yes      | `https://<backend-railway-domain>` (set in step 4c) |

### Not to set manually

- `PORT` — Railway injects this for every service. Both `server.js` and the `serve` start command already use `$PORT`.

---

## Common gotchas

- **Cookies don't survive a refresh in production.** Double-check `NODE_ENV=production` is set on the backend. The auth code only emits `SameSite=None; Secure` cookies when `NODE_ENV === 'production'`. Without that flag the browser refuses to send cross-site cookies and `/auth/me` looks like the user is logged out.
- **CORS 502 / `Access-Control-Allow-Origin` errors.** Means `FRONTEND_URL` on the backend doesn't match the actual frontend origin exactly (no trailing slash, must include `https://`).
- **Deep links 404 on the frontend.** The `serve` command must include the `-s` flag (SPA fallback). The repo defaults already have it.
- **`prisma migrate deploy` fails with `P3009`.** A migration was left in a bad state. From your laptop run `npx prisma migrate resolve --applied <name>` against the Railway `DATABASE_URL` (Railway → Postgres → **Connect** copies the URL), or as a last resort drop the `_prisma_migrations` table and run `migrate deploy` again. Don't use `prisma migrate dev` against the Railway DB — it tries to drop and recreate the database.
- **Changing `VITE_API_URL`.** Remember Vite bakes env vars into the bundle at build time. After editing the variable you must trigger a fresh build (Deployments → **Redeploy**).
