import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'uuid-of-plan' })
  @IsString()
  planId: string;

  @ApiProperty({ enum: PaymentMethod, example: 'MPESA' })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
