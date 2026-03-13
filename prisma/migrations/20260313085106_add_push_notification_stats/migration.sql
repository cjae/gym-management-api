-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushSentCount" INTEGER NOT NULL DEFAULT 0;
