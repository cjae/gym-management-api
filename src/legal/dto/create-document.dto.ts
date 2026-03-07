import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
