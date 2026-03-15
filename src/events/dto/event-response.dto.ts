import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
