import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class SalaryRecordResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  staffId: string;

  @ApiProperty({ example: 3 })
  month: number;

  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({ example: 50000 })
  amount: number;

  @ApiProperty({ example: 'KES' })
  currency: string;

  @ApiProperty({ enum: ['PENDING', 'PAID'] })
  status: string;

  @ApiPropertyOptional()
  paidAt?: Date;

  @ApiPropertyOptional({ example: 'March salary' })
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: UserResponseDto })
  staff?: UserResponseDto;
}
