import { IsString, IsOptional, IsDateString } from 'class-validator';

export class AssignMemberDto {
  @IsString()
  trainerId: string;

  @IsString()
  memberId: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
