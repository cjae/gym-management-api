-- H8 — surface subscriptions that need ops attention (persistent card auth
-- decrypt failure, etc.). Nullable — a non-null timestamp means "flagged at
-- this time; needs manual review".
ALTER TABLE "MemberSubscription"
    ADD COLUMN "billingFlaggedAt" TIMESTAMP(3);
