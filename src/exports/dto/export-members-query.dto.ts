import { IsOptional, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { UserStatus, Role } from '@prisma/client';

export enum ExportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
  PDF = 'pdf',
}

export class ExportMembersQueryDto {
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.CSV;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(30)
  endDate?: string;
}
