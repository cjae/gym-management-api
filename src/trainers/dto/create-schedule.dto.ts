import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateScheduleDto {
  @IsString()
  title: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}
