-- Snapshot the plan price onto MemberSubscription at creation time so the
-- billing cron can re-charge at the originally agreed price even if an admin
-- later changes the plan's price (H7). Also add a manual-review flag used by
-- the billing cron to surface subscriptions that need ops attention (H8).

-- Step 1: add the snapshot column nullable so backfill can populate it.
ALTER TABLE "MemberSubscription"
    ADD COLUMN "priceKes" DOUBLE PRECISION;

-- Step 2: backfill from the current plan price. Best we can do for historical
-- rows — from this point forward the creation paths always snapshot the
-- price-at-signup so this legacy drift window is closed.
UPDATE "MemberSubscription" ms
SET "priceKes" = sp."price"
FROM "SubscriptionPlan" sp
WHERE ms."planId" = sp."id"
  AND ms."priceKes" IS NULL;

-- Step 3: enforce NOT NULL now that every row is populated.
ALTER TABLE "MemberSubscription"
    ALTER COLUMN "priceKes" SET NOT NULL;

-- Step 4: billing-flag column for H8 (persistent auth-code decrypt failure and
-- similar cases the billing cron wants to surface to admins). Nullable — a
-- non-null timestamp means "flagged at this time; needs manual review".
ALTER TABLE "MemberSubscription"
    ADD COLUMN "billingFlaggedAt" TIMESTAMP(3);
