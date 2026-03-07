import { IsString, IsNumber, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateSalaryRecordDto {
  @IsString()
  staffId: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  year: number;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
