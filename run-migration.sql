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
