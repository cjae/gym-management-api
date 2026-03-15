import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertGymSettingsDto {
  @ApiPropertyOptional({
    example: 'Africa/Nairobi',
    description: 'IANA timezone identifier',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}
