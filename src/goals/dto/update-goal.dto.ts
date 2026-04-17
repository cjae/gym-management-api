import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { GoalStatus } from '@prisma/client';

export class UpdateGoalDto {
  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ description: 'ISO 8601 date string (must be future)' })
  @IsOptional()
  @IsDateString()
  userDeadline?: string;
}
