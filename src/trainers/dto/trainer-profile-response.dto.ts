import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class TrainerProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ example: 'Strength Training' })
  specialization?: string;

  @ApiPropertyOptional({
    example: 'Certified personal trainer with 5 years experience',
  })
  bio?: string;

  @ApiPropertyOptional({ example: { monday: '6am-12pm', tuesday: '6am-12pm' } })
  availability?: any;

  @ApiPropertyOptional({ type: UserResponseDto })
  user?: UserResponseDto;
}
