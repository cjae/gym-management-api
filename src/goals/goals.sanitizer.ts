import {
  Goal,
  GoalMilestone,
  GoalPlanItem,
  GoalProgressLog,
} from '@prisma/client';
import {
  GoalMilestoneResponseDto,
  GoalPlanItemResponseDto,
  GoalResponseDto,
} from './dto/goal-response.dto';

type FullGoal = Goal & {
  planItems?: GoalPlanItem[];
  milestones?: GoalMilestone[];
  progressLogs?: GoalProgressLog[];
};

const toNumber = (v: unknown) => (v == null ? null : Number(v));

const WEEKDAY_ORDER: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const dayIndex = (label: string): number => {
  const idx = WEEKDAY_ORDER[label.trim().toLowerCase()];
  return idx === undefined ? 7 : idx;
};

const sortPlanItems = <T extends GoalPlanItem>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    if (a.weekNumber !== b.weekNumber) return a.weekNumber - b.weekNumber;
    const dayDiff = dayIndex(a.dayLabel) - dayIndex(b.dayLabel);
    if (dayDiff !== 0) return dayDiff;
    return a.exerciseOrder - b.exerciseOrder;
  });

export function sanitizeGoal(
  goal: FullGoal,
  options: { includeError?: boolean } = {},
): GoalResponseDto {
  const { rawLlmResponse: _raw, generationError, ...rest } = goal;
  const startingValue = Number(goal.startingValue);
  const latestLog = goal.progressLogs?.[0];
  return {
    ...rest,
    startingValue,
    currentValue: latestLog ? Number(latestLog.value) : startingValue,
    targetValue: Number(goal.targetValue),
    generationError: options.includeError ? generationError : null,
    planItems: goal.planItems
      ? (sortPlanItems(goal.planItems).map((p) => ({
          ...p,
          weight: toNumber(p.weight),
          distanceKm: toNumber(p.distanceKm),
          paceMinPerKm: toNumber(p.paceMinPerKm),
        })) as GoalResponseDto['planItems'])
      : undefined,
    milestones: goal.milestones?.map((m) => ({
      ...m,
      targetValue: toNumber(m.targetValue),
    })) as GoalResponseDto['milestones'],
    progressLogs: goal.progressLogs?.map((l) => ({
      ...l,
      value: Number(l.value),
    })) as GoalResponseDto['progressLogs'],
  } as GoalResponseDto;
}

export function sanitizePlanItem(item: GoalPlanItem): GoalPlanItemResponseDto {
  return {
    ...item,
    weight: toNumber(item.weight),
    distanceKm: toNumber(item.distanceKm),
    paceMinPerKm: toNumber(item.paceMinPerKm),
  };
}

export function sanitizeMilestone(
  milestone: GoalMilestone,
): GoalMilestoneResponseDto {
  return { ...milestone, targetValue: toNumber(milestone.targetValue) };
}
