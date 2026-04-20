import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SafeMemberDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'] })
  role: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  status: string;
}

export class TrainerProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional()
  specialization?: string;

  @ApiPropertyOptional()
  bio?: string;

  @ApiProperty({ type: SafeMemberDto })
  user: SafeMemberDto;
}

export class ClassEnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: SafeMemberDto })
  member: SafeMemberDto;
}

export class GymClassResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  dayOfWeek: number;

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;

  @ApiProperty()
  maxCapacity: number;

  @ApiPropertyOptional({ format: 'uuid' })
  trainerId?: string;

  @ApiPropertyOptional({ type: TrainerProfileDto })
  trainer?: TrainerProfileDto;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'Enrollment count' })
  _count: { enrollments: number };

  @ApiPropertyOptional({
    type: [ClassEnrollmentResponseDto],
    description:
      'Enrolled members — only present for ADMIN/SUPER_ADMIN on GET /gym-classes/:id',
  })
  enrollments?: ClassEnrollmentResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedGymClassesResponseDto {
  @ApiProperty({ type: [GymClassResponseDto] })
  data: GymClassResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

export class MyClassEnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: GymClassResponseDto })
  gymClass: GymClassResponseDto;
}
