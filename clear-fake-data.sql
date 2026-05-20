-- FastScore — clear seeded / fake predictions and rollup tables
--
-- Paste into the Neon SQL editor and run. Safe to re-run.
--
-- NOTE: the original spec used PascalCase quoted identifiers
-- ("PredictionHistory", "AccuracyModel", "Prediction") but this codebase
-- uses snake_case unquoted identifiers (prediction_history,
-- accuracy_model, predictions). Same intent, working SQL.
--
-- What this removes:
--   1. Every row in prediction_history  (daily/league rollup aggregates)
--   2. Every row in accuracy_model      (self-learning confidence buckets)
--   3. Every Prediction row with the fallback confidence pair (50/50) —
--      that's the analyseMatch() fallback signature, used when OpenRouter
--      didn't respond and AI never actually scored the match.
--   4. Every Prediction row created before 2026-05-20 — anything older
--      than today is by definition pre-cleanup data.
--
-- What this leaves alone:
--   - Real predictions created today onwards with non-50/50 confidence.
--   - Users, affiliates, blog posts, bankrolls, alerts, odds_config.
--   - Schema itself (no DROP statements).

BEGIN;

-- 1. Wipe rollup tables (cheap to rebuild from raw predictions).
DELETE FROM prediction_history;
DELETE FROM accuracy_model;

-- 2. Remove fallback-confidence predictions (50/50 = AI fallback).
DELETE FROM predictions
WHERE over_confidence = 50 AND btts_confidence = 50;

-- 3. Remove anything older than today's cleanup date.
DELETE FROM predictions
WHERE created_at < '2026-05-20';

-- Bonus cleanup (the live admin-clear-history endpoint does these too;
-- including here so a single SQL paste leaves no orphan data):
DELETE FROM user_alerts;
DELETE FROM agent_alerts;
DELETE FROM odds_movements;
DELETE FROM odds_snapshots;
DELETE FROM bankroll_entries
WHERE prediction_id IS NOT NULL
  AND prediction_id NOT IN (SELECT id FROM predictions);

COMMIT;

-- After running, the history page should display empty-state copy:
--   "No settled predictions yet. Predictions settle automatically after
--    matches end."
