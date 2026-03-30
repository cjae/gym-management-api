import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
