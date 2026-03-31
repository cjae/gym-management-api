import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
