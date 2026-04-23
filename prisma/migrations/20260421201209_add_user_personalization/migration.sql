-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "PrimaryMotivation" AS ENUM ('APPEARANCE', 'STRENGTH', 'HEALTH', 'SPORT_PERFORMANCE', 'EVENT_SPECIFIC', 'OTHER');

-- AlterTable
ALTER TABLE "GymSettings" ALTER COLUMN "atRiskDays" SET DEFAULT 20,
ALTER COLUMN "dormantDays" SET DEFAULT 50,
ALTER COLUMN "inactiveDays" SET DEFAULT 20;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bodyweightKg" DECIMAL(5,2),
ADD COLUMN     "experienceLevel" "ExperienceLevel",
ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "injuryNotes" VARCHAR(500),
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "preferredTrainingDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "primaryMotivation" "PrimaryMotivation",
ADD COLUMN     "sessionMinutes" INTEGER,
ADD COLUMN     "sleepHoursAvg" DECIMAL(3,1);
