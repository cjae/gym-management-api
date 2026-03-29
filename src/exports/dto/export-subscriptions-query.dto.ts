import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  MaxLength,
} from 'class-validator';
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
  @MaxLength(36)
  planId?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  endDate?: string;
}
