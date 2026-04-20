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

export class EventEnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: SafeMemberDto })
  member: SafeMemberDto;
}

export class EventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;

  @ApiPropertyOptional()
  location?: string;

  @ApiProperty()
  maxCapacity: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'Enrollment count' })
  _count: { enrollments: number };

  @ApiPropertyOptional({
    type: [EventEnrollmentResponseDto],
    description:
      'Enrolled members — only present for ADMIN/SUPER_ADMIN on GET /events/:id',
  })
  enrollments?: EventEnrollmentResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedEventsResponseDto {
  @ApiProperty({ type: [EventResponseDto] })
  data: EventResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

export class MyEventEnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: EventResponseDto })
  event: EventResponseDto;
}

export class PaginatedMyEventsResponseDto {
  @ApiProperty({ type: [MyEventEnrollmentResponseDto] })
  data: MyEventEnrollmentResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
