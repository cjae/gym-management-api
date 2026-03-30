-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('SYSTEM', 'MANUAL');

-- AlterTable
ALTER TABLE "GymSettings" ADD COLUMN     "activeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "atRiskDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "dormantDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "inactiveDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "loyalStreakWeeks" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "newMemberDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" "TagSource" NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberTag" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "MemberTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MemberTag_memberId_tagId_key" ON "MemberTag"("memberId", "tagId");

-- AddForeignKey
ALTER TABLE "MemberTag" ADD CONSTRAINT "MemberTag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTag" ADD CONSTRAINT "MemberTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
