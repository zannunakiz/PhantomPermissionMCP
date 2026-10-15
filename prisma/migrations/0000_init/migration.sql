-- Step 19 baseline migration.
--
-- Intentionally a no-op: Step 19 owns connection/migration plumbing
-- only. Domain tables (tenants, API keys, models, versions,
-- simulations, reports, audit, idempotency) are added in Steps 20-23.
-- This file exists so `prisma migrate dev/deploy` history is
-- reproducible from the first persistence commit.
SELECT 1;
