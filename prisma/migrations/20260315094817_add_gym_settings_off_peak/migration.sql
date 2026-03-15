-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "isOffPeak" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GymSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OffPeakWindow" (
    "id" TEXT NOT NULL,
    "gymSettingsId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek",
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OffPeakWindow_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OffPeakWindow" ADD CONSTRAINT "OffPeakWindow_gymSettingsId_fkey" FOREIGN KEY ("gymSettingsId") REFERENCES "GymSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
