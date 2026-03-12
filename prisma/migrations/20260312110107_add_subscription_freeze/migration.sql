-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'FROZEN';

-- AlterTable
ALTER TABLE "MemberSubscription" ADD COLUMN     "freezeEndDate" TIMESTAMP(3),
ADD COLUMN     "freezeStartDate" TIMESTAMP(3),
ADD COLUMN     "frozenDaysUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "maxFreezeDays" INTEGER NOT NULL DEFAULT 0;
