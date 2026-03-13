-- AlterTable: migrate Streak from daily to weekly consistency model
ALTER TABLE "Streak" DROP COLUMN "currentStreak";
ALTER TABLE "Streak" ADD COLUMN "weeklyStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Streak" ADD COLUMN "daysThisWeek" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Streak" ADD COLUMN "weekStart" DATE NOT NULL DEFAULT (date_trunc('week', CURRENT_DATE)::date);

-- Remove the default on weekStart after backfilling existing rows
ALTER TABLE "Streak" ALTER COLUMN "weekStart" DROP DEFAULT;
