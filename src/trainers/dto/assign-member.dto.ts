import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignMemberDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsString()
  trainerId: string;

  @ApiProperty({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890' })
  @IsString()
  memberId: string;

  @ApiProperty({ example: '2026-03-07' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-06-07' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'Focus on strength training' })
  @IsOptional()
  @IsString()
  notes?: string;
}
