# FastScore — Netlify Deployment

Two providers, no CLI, no terminal beyond `npm install`:

| Provider     | What it hosts                                    | Free tier  |
| ------------ | ------------------------------------------------ | ---------- |
| **Neon**     | Postgres database (`users`, `predictions`, …)    | Yes        |
| **Netlify**  | Vite frontend + Netlify Functions (all the API)  | Yes        |

---

## 1. Set up Neon (5 min, all in browser)

1. Go to <https://neon.tech> → **Sign up** (GitHub / Google login).
2. After login you land on **Create Project**. Defaults are fine:
   - **Project name**: `fastscore`
   - **Region**: pick the one closest to you
   - **Postgres version**: latest
   - Click **Create Project**.
3. You'll land on the project dashboard. In the right-hand panel under **Connection string**, select **Pooled connection** from the dropdown and click the copy icon. It looks like:
   ```
   postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
   ```
   Save this string — it's your `DATABASE_URL`. **Use the pooled URL, not the direct one** — serverless functions open and close connections constantly, and the pooler is what makes that fast.
4. In the left sidebar click **SQL Editor**.
5. Open `schema.sql` from this repo (at the project root), copy its entire contents, paste into the editor, click **Run**.
6. You should see "Query ran successfully". Click **Tables** in the sidebar — you'll see `users`, `predictions`, `prediction_history` listed.

That's it for the database.

---

## 2. Get your API keys (still no terminal)

You need three external keys before deploying:

| Key                          | Where to get it                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `FOOTBALL_API_KEY`           | <https://dashboard.api-football.com> → **Account → API Key**                 |
| `OPENROUTER_API_KEY`         | <https://openrouter.ai/keys> → **Create key**                                |
| `WHOP_WEBHOOK_SECRET`        | Whop dashboard → Developer → Webhooks → reveal secret.                       |
| `WHOP_CHECKOUT_URL`          | Whop product → copy checkout link.                                           |
| `VITE_WHOP_CHECKOUT_URL`     | Same checkout URL — exposed to the client bundle by Vite.                    |

Generate the two JWT secrets in your browser DevTools console (Cmd/Ctrl+Shift+J on any page):

```js
crypto.getRandomValues(new Uint8Array(64)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
```

Run that command **twice** — save one value as `JWT_SECRET`, the other as `JWT_REFRESH_SECRET`. They must be different.

---

## 3. Deploy to Netlify (5 min)

### 3a. Connect the repo

1. Go to <https://app.netlify.com> → **Sign in with GitHub**.
2. On the dashboard click **Add new site → Import an existing project**.
3. Choose **GitHub**. Authorize Netlify for the `VantaEdge` repo if prompted. (Repo URL is unchanged.)
4. Pick the repo. Netlify auto-detects the build settings from `netlify.toml`:
   - **Base directory**: (empty / root)
   - **Build command**: `npm install && npm install --prefix frontend && npm run build --prefix frontend`
   - **Publish directory**: `frontend/dist`
   - **Functions directory**: `netlify/functions`

   Don't change anything — `netlify.toml` overrides these anyway.

5. **Before clicking "Deploy site"**, scroll down to **Environment variables** and add the seven entries below.

### 3b. Environment variables

| Variable                    | Value                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | The pooled Neon connection string from step 1.3                                                             |
| `JWT_SECRET`                | One of the 128-char hex strings from step 2                                                                 |
| `JWT_REFRESH_SECRET`        | The other 128-char hex string from step 2                                                                   |
| `FOOTBALL_API_KEY`          | From dashboard.api-football.com                                                                             |
| `OPENROUTER_API_KEY`        | From openrouter.ai/keys                                                                                     |
| `WHOP_WEBHOOK_SECRET`       | From Whop dashboard → Developer → Webhooks → reveal secret                                                  |
| `WHOP_CHECKOUT_URL`         | From Whop product → copy checkout link                                                                      |
| `VITE_WHOP_CHECKOUT_URL`    | Same checkout URL, exposed to the client bundle                                                             |
| `ADMIN_PASSWORD`            | A strong password for the `/admin` panel. Only credential for the admin UI — choose carefully.              |
| `NODE_ENV`                  | leave at Netlify's default (any value other than `development`) — controls whether auth cookies are issued `Secure` |
| `RESEND_API_KEY`            | _Optional._ Resend.com key for daily-digest email. Skip if you're not running notifications yet.            |
| `OPENWEATHER_API_KEY`       | _Optional._ OpenWeatherMap free tier — enables weather-aware predictions when wired in.                     |
| `ODDS_API_KEY`              | _Optional._ the-odds-api.com key for auto-fetching real bookmaker odds. Without it, the manual odds inputs on each match card stay enabled. |
| `GOOGLE_OAUTH_CLIENT_ID`    | _Optional._ Google OAuth 2.0 client ID — enables the "Continue with Google" button on /login and /register. See "5. Google sign-in (optional)" below. |
| `GOOGLE_OAUTH_CLIENT_SECRET`| _Optional._ Google OAuth 2.0 client secret. Both this and the client ID must be set for Google sign-in to activate. |

`URL` is set automatically by Netlify to your site's primary URL, so the OpenRouter `HTTP-Referer` is filled in for you. You don't need to set it manually.

Click **Deploy site**. The first build runs `npm install` at the root (Neon + bcrypt + jwt + cookie + axios for functions), then builds the Vite frontend, then bundles your functions with esbuild.

### 3c. (Optional) Custom domain

Site settings → **Domain management → Add a domain you already own**, or stick with the auto-generated `<random>.netlify.app` URL.

---

## 4. Whop webhook (only if you're charging money)

1. Whop dashboard → **Developer → Webhooks → New Webhook**.
2. **URL**: `https://<your-netlify-site>.netlify.app/api/webhook/whop`
3. Select events: `membership.went_valid`, `membership.was_created`, `membership.went_invalid`.
4. Reveal the webhook secret and paste it as `WHOP_WEBHOOK_SECRET` in Netlify env vars.
5. Create one $9.99/month recurring product (name: `FastScore SHARP`) and copy its checkout link into `WHOP_CHECKOUT_URL` and `VITE_WHOP_CHECKOUT_URL`.

---

## 5. Google sign-in (optional)

Skip if you only want email/password auth — the rest of the app works fine without it. The "Continue with Google" buttons on `/login` and `/register` will return a friendly 503 when not configured.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: `https://fastscore.eu` (and `https://<your-netlify-site>.netlify.app` for testing).
4. **Authorized redirect URIs**: `https://fastscore.eu/api/auth/google-callback` (and the same on the netlify.app URL).
5. Copy the **Client ID** → paste as `GOOGLE_OAUTH_CLIENT_ID` in Netlify env vars.
6. Copy the **Client Secret** → paste as `GOOGLE_OAUTH_CLIENT_SECRET` in Netlify env vars.
7. Trigger a fresh deploy. Both buttons now open Google's consent screen and create FREE-tier accounts on first sign-in.

If only one of the two env vars is set, the endpoint refuses to start the flow (returns 503) — the operator must set both.

---

## 6. Smoke test

1. Open your Netlify URL.
2. Click **Start Free** → register → you should land on `/dashboard`.
3. Open DevTools → **Application → Cookies** for your domain — you should see `accessToken` and `refreshToken` (both `HttpOnly`, `SameSite=Lax`).
4. Pick a SCOUT-tier league tab (MLS / Bundesliga / Eredivisie) — fixtures should load (or "No matches today" if there are no games scheduled).
5. Check **Functions → predictions** in Netlify dashboard → click the latest invocation to see logs.

---

## How redirects work

The frontend hits `/api/auth/login`. Netlify's redirect rules in `netlify.toml` rewrite that to `/.netlify/functions/auth/login` (status 200 = silent rewrite, same origin, no CORS). Each function inspects the sub-path after its name to route internally.

This is why cookies just work — frontend and functions share an origin, so the browser sends them automatically with no `SameSite=None` gymnastics.

---

## What lives where

```
FastScore/
├── netlify.toml             # build config + redirect rules
├── schema.sql               # paste into Neon SQL editor (one time)
├── package.json             # root — declares deps used by Netlify Functions
├── netlify/
│   └── functions/
│       ├── _shared/         # db, cookies, jwt, football, claude, ev, etc.
│       ├── auth.js          # /api/auth/* (register/login/refresh/logout/me)
│       ├── predictions.js   # /api/predictions/:leagueId
│       ├── history.js       # /api/history, /api/history/accuracy
│       ├── user.js          # /api/user/email, /api/user/password, DELETE /api/user
│       └── webhook.js       # /api/webhook/whop
└── frontend/
    ├── package.json         # Vite + React + Recharts
    └── src/                 # pages, components, AuthContext, API client
```

---

## Common gotchas

- **Function logs:** Netlify dashboard → your site → **Functions** → click a function to see invocation logs. Most "the site loads but nothing happens" issues are missing or mistyped env vars — the log will say `DATABASE_URL is not set` or `JWT_SECRET is not set`.
- **Direct vs pooled Neon URL.** Use the **pooled** one (URL hostname contains `-pooler`). The direct URL works but every cold start opens a fresh TCP connection and Neon's free tier rate-limits new connections aggressively.
- **Changing env vars** in Netlify requires a fresh deploy — go to **Deploys → Trigger deploy → Clear cache and deploy site**.
- **Frontend dev locally** still works with `cd frontend && npm install && npm run dev`, but functions won't run. If you want them locally, install Netlify CLI (`npm i -g netlify-cli`) and run `netlify dev` at the repo root — it spins up Vite + functions together. Not required.
