-- VantaEdge — paste this entire file into the Neon SQL editor and click "Run".
-- Safe to re-run: every CREATE uses IF NOT EXISTS, every ALTER uses IF NOT EXISTS,
-- every INSERT uses ON CONFLICT DO NOTHING.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE tier AS ENUM ('FREE', 'SCOUT', 'ANALYST', 'EDGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('ACTIVE', 'CANCELLED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('PENDING', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bankroll_entry_type AS ENUM ('BET', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bet_result AS ENUM ('WIN', 'LOSS', 'PENDING', 'PUSH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_status AS ENUM ('SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- Users
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT         NOT NULL UNIQUE,
  password_hash       TEXT         NOT NULL,
  tier                tier         NOT NULL DEFAULT 'FREE',
  revenuecat_id       TEXT,
  refresh_token       TEXT,
  daily_refreshes     INTEGER      NOT NULL DEFAULT 0,
  last_refresh_date   TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_time   TEXT    NOT NULL DEFAULT '08:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token   TEXT;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users(referred_by);
CREATE INDEX IF NOT EXISTS users_unsubscribe_token_idx ON users(unsubscribe_token);

-- =====================================================================
-- Predictions
-- =====================================================================
CREATE TABLE IF NOT EXISTS predictions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  league           TEXT        NOT NULL,
  fixture_id       INTEGER     NOT NULL,
  home_team        TEXT        NOT NULL,
  away_team        TEXT        NOT NULL,
  kickoff          TIMESTAMPTZ NOT NULL,
  over_line        REAL        NOT NULL,
  over_confidence  INTEGER     NOT NULL,
  over_hit         BOOLEAN,
  btts             TEXT        NOT NULL,
  btts_confidence  INTEGER     NOT NULL,
  btts_hit         BOOLEAN,
  ev_edge_over     REAL,
  ev_edge_btts     REAL,
  kelly_over       REAL,
  kelly_btts       REAL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-odds columns (filled by Odds API integration when wired in)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS best_over_odds        REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS best_over_bookmaker   TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS best_btts_odds        REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS best_btts_bookmaker   TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS auto_ev_over          REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS auto_ev_btts          REAL;

CREATE INDEX IF NOT EXISTS predictions_user_kickoff_idx ON predictions(user_id, kickoff DESC);
CREATE INDEX IF NOT EXISTS predictions_user_created_idx ON predictions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS predictions_kickoff_settled_idx
  ON predictions(kickoff) WHERE over_hit IS NULL;

-- =====================================================================
-- Prediction history (per-user accuracy rollups)
-- =====================================================================
CREATE TABLE IF NOT EXISTS prediction_history (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              TEXT    NOT NULL,
  total_predictions INTEGER NOT NULL,
  hits              INTEGER NOT NULL,
  accuracy          REAL    NOT NULL,
  league            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS prediction_history_user_idx ON prediction_history(user_id, date);

-- =====================================================================
-- Affiliate program
-- =====================================================================
CREATE TABLE IF NOT EXISTS affiliates (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code              TEXT         NOT NULL UNIQUE,
  total_referrals   INTEGER      NOT NULL DEFAULT 0,
  active_referrals  INTEGER      NOT NULL DEFAULT 0,
  total_earned      REAL         NOT NULL DEFAULT 0,
  pending_payout    REAL         NOT NULL DEFAULT 0,
  lifetime_payout   REAL         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliates_code_idx ON affiliates(code);

CREATE TABLE IF NOT EXISTS referrals (
  id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        UUID             NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referred_user_id    UUID             NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                tier             NOT NULL,
  status              referral_status  NOT NULL DEFAULT 'PENDING',
  monthly_commission  REAL             NOT NULL,
  created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  last_paid_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referrals_affiliate_idx ON referrals(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referrals_status_idx ON referrals(status);

CREATE TABLE IF NOT EXISTS payouts (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id  UUID           NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount        REAL           NOT NULL,
  status        payout_status  NOT NULL DEFAULT 'PENDING',
  payout_method TEXT,
  payout_dest   TEXT,
  requested_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payouts_affiliate_idx ON payouts(affiliate_id, requested_at DESC);

-- =====================================================================
-- Blog
-- =====================================================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT         NOT NULL UNIQUE,
  title        TEXT         NOT NULL,
  excerpt      TEXT         NOT NULL,
  content      TEXT         NOT NULL,
  category     TEXT         NOT NULL,
  read_time    INTEGER      NOT NULL,
  published_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blog_posts_published_idx ON blog_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS blog_posts_category_idx  ON blog_posts(category);

-- =====================================================================
-- Best bet of the day (daily cache; one row per date)
-- =====================================================================
CREATE TABLE IF NOT EXISTS best_bet (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  date           TEXT         NOT NULL UNIQUE,
  prediction_id  UUID         REFERENCES predictions(id) ON DELETE SET NULL,
  league         TEXT         NOT NULL,
  home_team      TEXT         NOT NULL,
  away_team      TEXT         NOT NULL,
  bet_type       TEXT         NOT NULL,
  line           REAL,
  confidence     INTEGER      NOT NULL,
  ev_edge        REAL,
  score          REAL         NOT NULL,
  kickoff        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- Bankroll
-- =====================================================================
CREATE TABLE IF NOT EXISTS bankrolls (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  starting_amount REAL         NOT NULL,
  current_amount  REAL         NOT NULL,
  currency        TEXT         NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bankroll_entries (
  id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_id   UUID                 REFERENCES predictions(id) ON DELETE SET NULL,
  type            bankroll_entry_type  NOT NULL,
  stake           REAL,
  odds            REAL,
  result          bet_result           NOT NULL DEFAULT 'PENDING',
  profit_loss     REAL                 NOT NULL DEFAULT 0,
  balance_before  REAL                 NOT NULL,
  balance_after   REAL                 NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bankroll_entries_user_idx ON bankroll_entries(user_id, created_at DESC);

-- =====================================================================
-- Email log (for digest history + debugging)
-- =====================================================================
CREATE TABLE IF NOT EXISTS email_log (
  id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     TEXT          NOT NULL,
  status   email_status  NOT NULL,
  sent_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS email_log_user_idx ON email_log(user_id, sent_at DESC);

-- =====================================================================
-- Odds API per-league enable/disable (admin-controlled)
-- =====================================================================
CREATE TABLE IF NOT EXISTS odds_config (
  league_id  INTEGER     PRIMARY KEY,
  enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Blog posts are auto-seeded by the /api/blog function the first time it
-- sees an empty blog_posts table. Canonical content lives in
-- netlify/functions/_shared/blog-content.js — edit there, restart, the
-- next request fills any new posts.
