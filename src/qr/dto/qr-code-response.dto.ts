import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QrCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'GYM-ABC123' })
  code: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  expiresAt?: Date;
}
