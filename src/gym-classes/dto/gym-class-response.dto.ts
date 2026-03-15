import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional()
  trainerId?: string;

  @ApiProperty()
  isActive: boolean;

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
