import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LlmMilestoneDto {
  @IsInt() @Min(1) weekNumber: number;
  @IsString() @MaxLength(200) description: string;
  @IsOptional() @IsNumber() @Min(0) targetValue?: number | null;
}

export class LlmPlanItemDto {
  @IsInt() @Min(1) weekNumber: number;
  @IsString() @MaxLength(20) dayLabel: string;
  @IsString() @MaxLength(200) description: string;
  @IsOptional() @IsInt() @Min(0) @Max(99) sets?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) reps?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(2000) weight?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(600) duration?: number | null;
}

export class LlmPlanResponseDto {
  @IsInt() @Min(1) @Max(7) recommendedGymFrequency: number;
  @IsInt() @Min(1) @Max(52) estimatedWeeks: number;
  @IsString() @MaxLength(2000) reasoning: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LlmMilestoneDto)
  milestones: LlmMilestoneDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LlmPlanItemDto)
  plan: LlmPlanItemDto[];
}
