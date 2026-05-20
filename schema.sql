-- VantaEdge — paste this entire file into the Neon SQL editor and click "Run".
-- Safe to re-run: every CREATE uses IF NOT EXISTS, every ALTER uses IF NOT EXISTS.

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

CREATE TABLE IF NOT EXISTS users (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT         NOT NULL UNIQUE,
  password_hash     TEXT         NOT NULL,
  tier              tier         NOT NULL DEFAULT 'FREE',
  revenuecat_id     TEXT,
  refresh_token     TEXT,
  daily_refreshes   INTEGER      NOT NULL DEFAULT 0,
  last_refresh_date TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Affiliate program: link from a user to the affiliate code that referred them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users(referred_by);

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

CREATE INDEX IF NOT EXISTS predictions_user_kickoff_idx ON predictions(user_id, kickoff DESC);
CREATE INDEX IF NOT EXISTS predictions_user_created_idx ON predictions(user_id, created_at DESC);

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
