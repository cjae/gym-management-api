import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTrainerProfileDto {
  @ApiPropertyOptional({ example: 'Weight Training' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  specialization?: string;

  @ApiPropertyOptional({ example: 'Certified personal trainer' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({
    example: { monday: '06:00-12:00', wednesday: '06:00-12:00' },
  })
  @IsOptional()
  availability?: any;
}
