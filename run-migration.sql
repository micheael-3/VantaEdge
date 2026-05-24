-- FastScore self-learning upgrade migration.
-- Paste this entire file into the Neon SQL editor and click "Run".
-- Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT guards.
--
-- Note on naming: the spec called for camelCase table/column names
-- ("Prediction"."debateJson", "Calibration"."correctionFactor", etc.).
-- The existing FastScore schema is entirely snake_case (`predictions`,
-- `users`, `prediction_id`). To keep the new self-learning tables
-- consistent with the rest of the DB — and avoid every existing JOIN
-- breaking — this migration writes the new columns / tables in
-- snake_case. The backend code in claude.js, calibration.js,
-- predictions.js, agent-results.js, agent-accuracy.js, persona.js
-- and feedback.js already uses these snake_case names.

-- 1. Per-prediction debate transcript, post-settle accuracy, and the
--    new per-prediction calibrated confidence columns. The pipeline
--    fills calibrated_over_confidence / calibrated_btts_confidence on
--    INSERT (predictions-scan-background.js) and the dashboard reads
--    them directly.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS debate_json                 JSONB;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS accuracy_score              REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS calibrated_over_confidence  INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS calibrated_btts_confidence  INTEGER;

-- 1a. Actual final score columns. agent-results computes calc.home /
--     calc.away to derive hit/miss but discards the raw goal counts.
--     Storing them lets the dashboard render "FT 2–1" on settled cards
--     without re-hitting API-Football and powers the Resettle recovery.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS home_goals                  INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS away_goals                  INTEGER;

-- 1b. settled_at — the moment agent-results successfully wrote hit/miss.
--     Used as a guard so the resettle pipeline can't re-process the same
--     row twice. Settlement check is now:
--       WHERE kickoff < NOW() AND over_hit IS NULL AND settled_at IS NULL
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS settled_at                  TIMESTAMPTZ;

-- 1c. CRITICAL — dedup the predictions table and prevent recurrence.
--
-- Two cleanups must run before the UNIQUE constraint, or the ALTER fails:
--   a) Drop ghost rows with over_confidence = 0 or NULL. Those are
--      either recovery placeholders (from /api/admin/recover-history)
--      or never-settled OpenRouter-failure rows; either way they don't
--      belong in the live predictions stream.
--   b) Collapse duplicate (fixture_id) rows to the single best by
--      over_confidence, breaking ties with newest created_at.
--
-- Once the table has at most one row per fixture_id, the UNIQUE
-- constraint locks it in. Future scans use ON CONFLICT (fixture_id)
-- DO UPDATE so re-runs always overwrite the existing row instead of
-- inserting a sibling.
DELETE FROM predictions
WHERE over_confidence = 0 OR over_confidence IS NULL;

DELETE FROM predictions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY fixture_id
             ORDER BY over_confidence DESC, created_at DESC
           ) AS rn
    FROM predictions
  ) sub
  WHERE rn > 1
);

-- Idempotent constraint add — name guards against the IF NOT EXISTS
-- gap (Postgres doesn't support IF NOT EXISTS on ADD CONSTRAINT before
-- v18). Wrap in a DO block to make re-runnable.
DO $$ BEGIN
  ALTER TABLE predictions
    ADD CONSTRAINT prediction_fixture_unique UNIQUE (fixture_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- INTELLIGENCE EVOLUTION SYSTEM (sport/league agnostic)
-- =====================================================================
-- All three new tables include both `sport` and `league` text columns so
-- future sports (UFC, World Cup, CL) drop into the same schema with no
-- ALTERs. The application reads sport/league identifiers from
-- _shared/sports.js — never hardcoded.

-- Post-settle Claude autopsy of every prediction.
CREATE TABLE IF NOT EXISTS prediction_autopsy (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id        UUID         REFERENCES predictions(id) ON DELETE CASCADE,
  sport                TEXT         NOT NULL,
  league               TEXT         NOT NULL,
  was_correct          BOOLEAN,
  primary_reason       TEXT,
  misleading_factors   JSONB,
  raw_response         JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS prediction_autopsy_prediction_idx
  ON prediction_autopsy(prediction_id);
CREATE INDEX IF NOT EXISTS prediction_autopsy_sport_idx
  ON prediction_autopsy(sport, league, created_at DESC);

-- Rules extracted by the autopsy agent (and the pattern miner). Injected
-- into the Analyst's system prompt on every new prediction. Toggle via
-- the `active` flag from the Admin Intelligence tab if a rule starts to
-- hurt instead of help.
CREATE TABLE IF NOT EXISTS learned_rules (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sport                  TEXT         NOT NULL,
  league                 TEXT         NOT NULL,
  condition              TEXT         NOT NULL,
  adjustment             TEXT         NOT NULL,
  supporting_predictions INTEGER      NOT NULL DEFAULT 1,
  accuracy_improvement   REAL,
  confidence             INTEGER,
  active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  source                 TEXT         NOT NULL DEFAULT 'autopsy',
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learned_rules_active_idx
  ON learned_rules(sport, league, active);

-- Statistical patterns mined weekly from settled-prediction history.
CREATE TABLE IF NOT EXISTS pattern_insights (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sport             TEXT         NOT NULL,
  league            TEXT         NOT NULL,
  dimension         TEXT         NOT NULL,
  dimension_value   TEXT         NOT NULL,
  sample_count      INTEGER      NOT NULL,
  hit_rate          REAL         NOT NULL,
  overall_hit_rate  REAL         NOT NULL,
  delta             REAL         NOT NULL,
  insight           TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pattern_insights_sport_idx
  ON pattern_insights(sport, league, created_at DESC);

-- New columns on predictions:
--   sport               — explicit sport key from _shared/sports.js. The
--                         existing `league` column stores the legacy
--                         human-readable label ('MLS'); `sport` stores
--                         the canonical id ('mls') so cross-sport joins
--                         are sane.
--   is_contrarian       — true when the AI's call goes against the
--                         obvious stats. Surfaced as an amber badge in
--                         MatchCard so PRO users can spot value picks.
--   confidence_updated  — true after a late-window re-analysis bumped
--                         confidence by >10pts (pipeline ships later).
--   confidence_previous — the confidence we shipped before that update,
--                         so the UI can render "~~74%~~ → 61%".
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS sport               TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS is_contrarian       BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS confidence_updated  BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS confidence_previous INTEGER;

-- 2. Per-league, per-market calibration. agent-results.js calls
--    updateCalibration() on every settle; predictions-scan-background.js
--    reads correction_factor at insert time to compute the calibrated
--    confidence columns. Defaults to 1.0 (= raw) until we have ≥10
--    samples in a bucket.
CREATE TABLE IF NOT EXISTS calibration (
  id                SERIAL       PRIMARY KEY,
  league            TEXT         NOT NULL,
  market            TEXT         NOT NULL,        -- 'over' | 'btts'
  correction_factor REAL         NOT NULL DEFAULT 1.0,
  sample_count      INTEGER      NOT NULL DEFAULT 0,
  mean_confidence   REAL,
  actual_win_rate   REAL,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (league, market)
);

-- 3. Single-row persona state — id is locked to 1 by the CHECK
--    constraint. agent-accuracy.js rewrites mood + catchphrase from
--    the rolling 24h hit-rate; /api/persona returns it.
CREATE TABLE IF NOT EXISTS persona_state (
  id           INTEGER      PRIMARY KEY DEFAULT 1,
  mood         TEXT         NOT NULL DEFAULT 'analytical',
  catchphrase  TEXT         NOT NULL DEFAULT 'The data never lies.',
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT persona_state_singleton CHECK (id = 1)
);
INSERT INTO persona_state (id, mood, catchphrase)
  VALUES (1, 'analytical', 'The data never lies.')
  ON CONFLICT (id) DO NOTHING;

-- 4. Per-user feedback on individual predictions. UNIQUE (user_id,
--    prediction_id) means a user can rate the same pick once — repeat
--    POSTs from the same user upsert in the application layer (or
--    return 409, depending on call site).
CREATE TABLE IF NOT EXISTS feedback (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_id  UUID         NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  rating         INTEGER      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, prediction_id)
);
CREATE INDEX IF NOT EXISTS feedback_user_idx       ON feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_prediction_idx ON feedback(prediction_id);
