import { ApiProperty } from '@nestjs/swagger';

export class PaymentInitResponseDto {
  @ApiProperty({ example: 'https://checkout.paystack.com/abc123' })
  authorization_url: string;

  @ApiProperty({ example: 'abc123xyz' })
  access_code: string;

  @ApiProperty({ example: 'ref_abc123' })
  reference: string;
}
