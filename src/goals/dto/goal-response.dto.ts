import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GoalCategory,
  GoalGenerationStatus,
  GoalMetric,
  GoalStatus,
} from '@prisma/client';

export class GoalPlanItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() weekNumber: number;
  @ApiProperty() dayLabel: string;
  @ApiProperty() exerciseOrder: number;
  @ApiProperty() description: string;
  @ApiPropertyOptional() workoutType: string | null;
  @ApiPropertyOptional() muscleGroup: string | null;
  @ApiPropertyOptional() sets: number | null;
  @ApiPropertyOptional() reps: number | null;
  @ApiPropertyOptional() weight: number | null;
  @ApiPropertyOptional() duration: number | null;
  @ApiPropertyOptional() restSeconds: number | null;
  @ApiPropertyOptional() distanceKm: number | null;
  @ApiPropertyOptional() paceMinPerKm: number | null;
  @ApiPropertyOptional() notes: string | null;
  @ApiProperty() completed: boolean;
  @ApiPropertyOptional() completedAt: Date | null;
}

export class GoalMilestoneResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() weekNumber: number;
  @ApiProperty() description: string;
  @ApiPropertyOptional() targetValue: number | null;
  @ApiProperty() completed: boolean;
  @ApiPropertyOptional() completedAt: Date | null;
}

export class GoalProgressLogResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() value: number;
  @ApiPropertyOptional() note: string | null;
  @ApiProperty() loggedAt: Date;
}

export class GoalResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() memberId: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: GoalCategory }) category: GoalCategory;
  @ApiProperty({ enum: GoalMetric }) metric: GoalMetric;
  @ApiProperty() currentValue: number;
  @ApiProperty() targetValue: number;
  @ApiProperty() currentGymFrequency: number;
  @ApiPropertyOptional() userRequestedFrequency: number | null;
  @ApiPropertyOptional() recommendedGymFrequency: number | null;
  @ApiPropertyOptional() aiEstimatedDeadline: Date | null;
  @ApiPropertyOptional() userDeadline: Date | null;
  @ApiPropertyOptional() aiReasoning: string | null;
  @ApiProperty({ enum: GoalGenerationStatus })
  generationStatus: GoalGenerationStatus;
  @ApiPropertyOptional() generationError: string | null;
  @ApiProperty({ enum: GoalStatus }) status: GoalStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [GoalPlanItemResponseDto] })
  planItems?: GoalPlanItemResponseDto[];
  @ApiPropertyOptional({ type: [GoalMilestoneResponseDto] })
  milestones?: GoalMilestoneResponseDto[];
  @ApiPropertyOptional({ type: [GoalProgressLogResponseDto] })
  progressLogs?: GoalProgressLogResponseDto[];
}

export class PaginatedGoalsResponseDto {
  @ApiProperty({ type: [GoalResponseDto] }) data: GoalResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() activeCount: number;
  @ApiProperty() cap: number;
}
