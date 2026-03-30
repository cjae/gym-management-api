import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeletionRequestUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  email: string;
}

export class DeletionRequestResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] })
  status: string;

  @ApiPropertyOptional()
  reviewedById?: string;

  @ApiPropertyOptional()
  reviewedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class DeletionRequestWithUserResponseDto extends DeletionRequestResponseDto {
  @ApiProperty({ type: DeletionRequestUserDto })
  user: DeletionRequestUserDto;
}

export class PaginatedDeletionRequestsResponseDto {
  @ApiProperty({ type: [DeletionRequestWithUserResponseDto] })
  data: DeletionRequestWithUserResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
