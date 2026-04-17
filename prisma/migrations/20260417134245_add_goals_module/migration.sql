-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('STRENGTH', 'WEIGHT_LOSS', 'MUSCLE_GAIN', 'CONSISTENCY', 'ENDURANCE', 'BODY_COMPOSITION', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GoalGenerationStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('KG', 'LBS', 'REPS', 'CM', 'PERCENT', 'DAYS_PER_WEEK', 'MINUTES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GOAL_PLAN_READY';
ALTER TYPE "NotificationType" ADD VALUE 'GOAL_PLAN_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'GOAL_WEEKLY_PULSE';

-- AlterTable
ALTER TABLE "GymSettings" ADD COLUMN     "maxActiveGoalsPerMember" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "GoalCategory" NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "currentValue" DECIMAL(10,2) NOT NULL,
    "targetValue" DECIMAL(10,2) NOT NULL,
    "currentGymFrequency" INTEGER NOT NULL,
    "recommendedGymFrequency" INTEGER,
    "aiEstimatedDeadline" TIMESTAMP(3),
    "userDeadline" TIMESTAMP(3),
    "aiReasoning" TEXT,
    "rawLlmResponse" JSONB,
    "generationStatus" "GoalGenerationStatus" NOT NULL DEFAULT 'GENERATING',
    "generationError" TEXT,
    "generationStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalPlanItem" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "dayLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sets" INTEGER,
    "reps" INTEGER,
    "weight" DECIMAL(10,2),
    "duration" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalMilestone" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "targetValue" DECIMAL(10,2),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalProgressLog" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalProgressLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_memberId_status_idx" ON "Goal"("memberId", "status");

-- CreateIndex
CREATE INDEX "GoalPlanItem_goalId_weekNumber_idx" ON "GoalPlanItem"("goalId", "weekNumber");

-- CreateIndex
CREATE INDEX "GoalMilestone_goalId_weekNumber_idx" ON "GoalMilestone"("goalId", "weekNumber");

-- CreateIndex
CREATE INDEX "GoalProgressLog_goalId_loggedAt_idx" ON "GoalProgressLog"("goalId", "loggedAt");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPlanItem" ADD CONSTRAINT "GoalPlanItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalProgressLog" ADD CONSTRAINT "GoalProgressLog_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
