import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrainerProfileDto {
  @ApiProperty({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890' })
  @IsString()
  userId: string;

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
