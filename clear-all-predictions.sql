-- clear-all-predictions.sql
--
-- Canonical wipe for the prediction pipeline. Use AFTER deploying a
-- pipeline change (e.g. the Cyprus-TZ + form fix + validation work
-- in the data-correctness commit) so the next weekly scan repopulates
-- everything against fresh, correct data.
--
-- Two ways to apply:
--
--   1. (Recommended) Hit the existing admin endpoint — it does the
--      same DELETEs across 10 related tables AND fires a fresh
--      background scan automatically:
--
--        GET /api/admin/clear-history?key=<ADMIN_PASSWORD>
--
--   2. Paste this SQL into the Neon SQL editor (or `psql`) when you
--      only want to wipe the prediction tables and re-run the scan
--      manually via Admin → Force Rescan.
--
-- This file is idempotent. Running it on an already-empty DB is a
-- no-op (DELETE on empty tables is allowed and just reports 0 rows).
--
-- Order matters: child tables before parents so foreign-key references
-- don't block the delete.

BEGIN;

-- Bankroll entries reference predictions.id by FK in some deployments,
-- so wipe them first. The auto-settle path will re-create rows for
-- any future bets the user logs against rescanned predictions.
DELETE FROM bankroll_entries WHERE prediction_id IS NOT NULL;

-- Per-fixture odds snapshots/movements are populated by the agent
-- scanner's per-tick odds pass. They'll repopulate within 30 minutes
-- after the rescan.
DELETE FROM odds_snapshots;
DELETE FROM odds_movements;

-- Per-fixture alerts (sharp moves, settled results, best-bet
-- announcements). The fanout queue in agent-alerts will repopulate
-- as new alerts are emitted by the next runs.
DELETE FROM user_alerts;
DELETE FROM agent_alerts;

-- Calibration model — accuracy_model rows are rebuilt by the
-- agent-accuracy job at 03:00 UTC daily. Wiping them now means the
-- next /week response will show raw confidence until the first run.
DELETE FROM accuracy_model;

-- Best-bet-of-the-day picks. agent-best-bet (07:00 UTC daily) will
-- choose a fresh one against the new predictions.
DELETE FROM best_bet;

-- Prediction history (per-rescan trail) and the live predictions
-- themselves. This is the heart of the wipe.
DELETE FROM prediction_history;
DELETE FROM predictions;

-- Scan status rows — without this, the agent-scanner's
-- ensureWeeklyScanReady() guard sees "complete" for this week and
-- refuses to re-trigger. Clearing it lets the next dashboard load
-- (or the next cron tick) fire a fresh background scan.
DELETE FROM scan_status;

COMMIT;

-- After commit, trigger the rescan:
--   * UI:   Admin -> Agent -> Force Rescan
--   * CLI:  curl -X POST "https://<site>/.netlify/functions/predictions-scan-background" \
--               -H "x-internal-scan-secret: $JWT_SECRET" \
--               -H "content-type: application/json" \
--               -d '{"leagueId":253,"weekStart":"<YYYY-MM-DD Monday>"}'
--
-- The first dashboard load after the wipe will also auto-trigger the
-- scan if scan_status was cleared above (see handleWeek in
-- netlify/functions/predictions.js).
