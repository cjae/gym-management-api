-- Adds a per-(discountCode, member) counter table that enforces `maxUsesPerMember`
-- atomically via a conditional `updateMany` increment. Also stores "benefit" counts
-- for duo-subscription secondary members so the per-member cap cannot be bypassed
-- by switching between a shared duo sub and a separate solo sub.

CREATE TABLE "DiscountRedemptionCounter" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRedemptionCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscountRedemptionCounter_discountCodeId_memberId_key"
    ON "DiscountRedemptionCounter"("discountCodeId", "memberId");

CREATE INDEX "DiscountRedemptionCounter_memberId_idx"
    ON "DiscountRedemptionCounter"("memberId");

-- Backfill counter rows from existing DiscountRedemption records.
-- For every past redemption, every member of that subscription (primary + secondaries
-- via SubscriptionMember) has "benefited" once and must be credited.
INSERT INTO "DiscountRedemptionCounter" ("id", "discountCodeId", "memberId", "uses", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    r."discountCodeId",
    sm."memberId",
    COUNT(*)::int,
    NOW(),
    NOW()
FROM "DiscountRedemption" r
JOIN "SubscriptionMember" sm ON sm."subscriptionId" = r."subscriptionId"
GROUP BY r."discountCodeId", sm."memberId"
ON CONFLICT ("discountCodeId", "memberId") DO NOTHING;
