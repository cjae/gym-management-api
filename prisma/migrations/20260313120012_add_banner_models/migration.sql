-- CreateEnum
CREATE TYPE "BannerCtaType" AS ENUM ('NONE', 'DEEP_LINK', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "BannerInteractionType" AS ENUM ('IMPRESSION', 'TAP');

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT NOT NULL,
    "ctaType" "BannerCtaType" NOT NULL DEFAULT 'NONE',
    "ctaTarget" TEXT,
    "ctaLabel" TEXT,
    "discountCode" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerInteraction" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BannerInteractionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Banner_isPublished_startDate_endDate_deletedAt_idx" ON "Banner"("isPublished", "startDate", "endDate", "deletedAt");

-- CreateIndex
CREATE INDEX "Banner_createdBy_idx" ON "Banner"("createdBy");

-- CreateIndex
CREATE INDEX "BannerInteraction_bannerId_type_idx" ON "BannerInteraction"("bannerId", "type");

-- CreateIndex
CREATE INDEX "BannerInteraction_userId_idx" ON "BannerInteraction"("userId");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerInteraction" ADD CONSTRAINT "BannerInteraction_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerInteraction" ADD CONSTRAINT "BannerInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
