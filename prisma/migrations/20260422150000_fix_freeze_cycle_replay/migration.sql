-- L7 — cycle-identity anchor for the freeze counters (frozenDaysUsed,
-- freezeCount) on MemberSubscription. Stores the `endDate` value as of
-- the most recent counter reset. The reset + anchor write must be
-- atomic with the endDate advance on renewal, so that a replayed webhook
-- (same endDate) will NOT re-reset the counters and let a member churn
-- additional freezes within a single billing cycle.
--
-- Nullable — existing rows retain their current counters and will be
-- lazily anchored on the next freeze or renewal. See subscriptions.service
-- `resetFreezeCountersIfStale` and payments.service renewal path.
ALTER TABLE "MemberSubscription"
    ADD COLUMN "freezeCycleAnchor" TIMESTAMP(3);
