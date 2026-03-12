-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';
ALTER TYPE "PaymentMethod" ADD VALUE 'COMPLIMENTARY';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "MemberSubscription" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "paymentNote" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentNote" TEXT;

-- AddForeignKey
ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
