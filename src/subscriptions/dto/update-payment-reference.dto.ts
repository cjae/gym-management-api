import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePaymentReferenceDto {
  @ApiProperty({
    example: 'MPESA-TXN-ABC123',
    maxLength: 200,
    description:
      'Payment reference (e.g., M-Pesa transaction code, bank transfer ref)',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  paymentReference: string;
}
