import { IsOptional, IsEnum, IsDateString, IsUUID } from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';
import { ExportFormat } from './export-members-query.dto';

export class ExportSubscriptionsQueryDto {
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.CSV;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
