import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentSignatureResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty({ format: 'uuid' })
  documentId: string;

  @ApiProperty()
  signatureData: string;

  @ApiProperty()
  signedAt: Date;

  @ApiPropertyOptional({ example: '192.168.1.1' })
  ipAddress?: string;
}
