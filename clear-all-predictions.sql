-- clear-all-predictions.sql
-- Run once in the Neon SQL editor to wipe every per-user prediction artefact.
-- This is destructive and unrecoverable. After running, /api/predictions/week
-- will see an empty table for everyone and trigger a fresh weekly scan on the
-- next dashboard load.
DELETE FROM prediction_history;
DELETE FROM accuracy_model;
DELETE FROM best_bet;
DELETE FROM predictions;
