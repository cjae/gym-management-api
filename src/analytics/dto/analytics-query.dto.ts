import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum Granularity {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity = Granularity.MONTHLY;
}
