import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FreezeSubscriptionDto {
  @ApiProperty({
    example: 10,
    description: 'Number of days to freeze (1 to plan maxFreezeDays)',
  })
  @IsInt()
  @Min(1)
  days: number;
}
