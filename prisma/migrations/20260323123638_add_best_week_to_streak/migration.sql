-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MILESTONE';

-- AlterTable
ALTER TABLE "Streak" ADD COLUMN     "bestWeek" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MilestoneNotification" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "milestoneType" TEXT NOT NULL,
    "milestoneValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneNotification_memberId_milestoneType_milestoneValue_key" ON "MilestoneNotification"("memberId", "milestoneType", "milestoneValue");

-- AddForeignKey
ALTER TABLE "MilestoneNotification" ADD CONSTRAINT "MilestoneNotification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
