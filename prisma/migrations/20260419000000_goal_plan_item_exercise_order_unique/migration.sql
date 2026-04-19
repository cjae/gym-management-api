-- Defensive backfill: if any existing rows share (goalId, weekNumber, dayLabel),
-- renumber them 1..N by createdAt so the upcoming unique index can be added.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "goalId", "weekNumber", "dayLabel"
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "GoalPlanItem"
)
UPDATE "GoalPlanItem" g
SET "exerciseOrder" = ranked.rn
FROM ranked
WHERE g."id" = ranked."id"
  AND g."exerciseOrder" <> ranked.rn;

-- CreateIndex
CREATE UNIQUE INDEX "GoalPlanItem_goalId_weekNumber_dayLabel_exerciseOrder_key" ON "GoalPlanItem"("goalId", "weekNumber", "dayLabel", "exerciseOrder");
