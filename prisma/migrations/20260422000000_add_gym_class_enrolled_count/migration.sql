-- AlterTable
ALTER TABLE "GymClass" ADD COLUMN "enrolledCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows with current enrollment counts so the counter matches reality.
UPDATE "GymClass" gc
SET "enrolledCount" = COALESCE(sub.cnt, 0)
FROM (
  SELECT "classId", COUNT(*)::int AS cnt
  FROM "ClassEnrollment"
  GROUP BY "classId"
) sub
WHERE sub."classId" = gc.id;
