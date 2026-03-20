-- AlterTable
ALTER TABLE "MemberSubscription" ADD COLUMN     "freezeCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "maxFreezeCount" INTEGER NOT NULL DEFAULT 1;
