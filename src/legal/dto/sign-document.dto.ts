import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignDocumentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsString()
  documentId: string;

  @ApiProperty({ example: 'data:image/png;base64,...' })
  @IsString()
  @MaxLength(500000)
  signatureData: string; // base64 encoded signature image
}
