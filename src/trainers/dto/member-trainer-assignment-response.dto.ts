import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GymClassResponseDto } from '../../gym-classes/dto/gym-class-response.dto';

/**
 * Slim trainer user profile shown to the assigned member.
 * Excludes contact fields (email, phone) and role/status — members
 * only need the trainer's name and photo.
 */
export class MemberFacingTrainerUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
    nullable: true,
  })
  displayPicture?: string | null;
}

/**
 * Trainer profile shown to the assigned member via GET /trainers/my/trainer.
 * Excludes the `assignments` list (so one member can't enumerate the trainer's
 * other clients) and the trainer user's email/phone.
 */
export class MemberFacingTrainerProfileDto {
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

  @ApiPropertyOptional({ type: MemberFacingTrainerUserDto })
  user?: MemberFacingTrainerUserDto;

  @ApiPropertyOptional({
    type: [GymClassResponseDto],
    description: 'Active classes taught by this trainer',
  })
  classes?: GymClassResponseDto[];
}

export class MemberTrainerAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  trainerId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  startDate: Date;

  @ApiPropertyOptional({ nullable: true })
  endDate?: Date | null;

  @ApiPropertyOptional({ example: 'Focus on cardio and flexibility' })
  notes?: string;

  @ApiPropertyOptional({ type: () => MemberFacingTrainerProfileDto })
  trainer?: MemberFacingTrainerProfileDto;
}
