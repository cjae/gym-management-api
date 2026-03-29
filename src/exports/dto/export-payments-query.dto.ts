import { IsOptional, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { ExportFormat } from './export-members-query.dto';

export class ExportPaymentsQueryDto {
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.CSV;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  endDate?: string;
}
