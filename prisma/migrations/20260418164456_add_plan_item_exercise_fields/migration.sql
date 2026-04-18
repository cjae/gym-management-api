-- AlterTable
ALTER TABLE "GoalPlanItem" ADD COLUMN     "exerciseOrder" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "muscleGroup" TEXT,
ADD COLUMN     "restSeconds" INTEGER,
ADD COLUMN     "workoutType" TEXT;
