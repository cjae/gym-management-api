import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrainerProfileDto {
  @ApiProperty({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({ example: 'Weight Training' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'Certified personal trainer' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    example: { monday: '06:00-12:00', wednesday: '06:00-12:00' },
  })
  @IsOptional()
  availability?: any;
}
