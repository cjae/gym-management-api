import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDocumentDto {
  @ApiProperty({ example: 'Liability Waiver' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'By signing this document, you acknowledge...' })
  @IsString()
  @MaxLength(50000)
  content: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
