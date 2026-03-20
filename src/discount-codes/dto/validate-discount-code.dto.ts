import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateDiscountCodeDto {
  @ApiProperty({ example: 'NEWYEAR25' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code: string;

  @ApiProperty({ example: 'plan-uuid' })
  @IsUUID()
  planId: string;
}
