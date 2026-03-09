import { ApiProperty } from '@nestjs/swagger';
import { LegalDocumentResponseDto } from './legal-document-response.dto';

export class PaginatedDocumentsResponseDto {
  @ApiProperty({ type: [LegalDocumentResponseDto] })
  data: LegalDocumentResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
