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

export function sanitizeGoal(
  goal: FullGoal,
  options: { includeError?: boolean } = {},
): GoalResponseDto {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rawLlmResponse: _raw, generationError, ...rest } = goal;
  return {
    ...rest,
    currentValue: Number(goal.currentValue),
    targetValue: Number(goal.targetValue),
    generationError: options.includeError ? generationError : null,
    planItems: goal.planItems?.map((p) => ({
      ...p,
      weight: toNumber(p.weight),
    })) as GoalResponseDto['planItems'],
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
  return { ...item, weight: toNumber(item.weight) };
}

export function sanitizeMilestone(
  milestone: GoalMilestone,
): GoalMilestoneResponseDto {
  return { ...milestone, targetValue: toNumber(milestone.targetValue) };
}
