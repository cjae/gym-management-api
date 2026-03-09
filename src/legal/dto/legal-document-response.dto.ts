import { ApiProperty } from '@nestjs/swagger';

export class LegalDocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Terms of Service' })
  title: string;

  @ApiProperty({ example: 'By signing this document...' })
  content: string;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({ example: true })
  isRequired: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
