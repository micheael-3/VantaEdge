-- FastScore — promote the founder account to admin.
--
-- Paste into the Neon SQL editor and run once. Safe to re-run (idempotent).
--
-- NOTE: the original spec used Prisma-style PascalCase quoted identifiers
--   UPDATE "User" SET "isAdmin" = TRUE WHERE LOWER("email") = LOWER('...');
-- That fails against this schema, which uses snake_case unquoted columns
-- on the `users` table. The corrected snippet below is what actually runs.

-- Set admin for the founder account. Run once in Neon SQL editor.
UPDATE users SET is_admin = TRUE WHERE LOWER(email) = LOWER('panayidesmichalis81@gmail.com');
