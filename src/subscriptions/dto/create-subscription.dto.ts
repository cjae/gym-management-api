import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MemberPaymentMethod {
  CARD = 'CARD',
  MPESA = 'MPESA',
}

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'uuid-of-plan' })
  @IsString()
  planId: string;

  @ApiProperty({ enum: MemberPaymentMethod, example: 'MPESA' })
  @IsEnum(MemberPaymentMethod)
  paymentMethod: MemberPaymentMethod;
}
