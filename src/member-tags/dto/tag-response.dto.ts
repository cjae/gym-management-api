import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'at-risk' })
  name: string;

  @ApiPropertyOptional({ example: 'Active sub but no recent check-in' })
  description?: string;

  @ApiProperty({ enum: ['SYSTEM', 'MANUAL'], example: 'SYSTEM' })
  source: string;

  @ApiPropertyOptional({ example: '#FF5733' })
  color?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TagWithCountResponseDto extends TagResponseDto {
  @ApiProperty({ example: 12 })
  memberCount: number;
}

export class TagSummaryResponseDto {
  @ApiProperty({ type: [TagWithCountResponseDto] })
  tags: TagWithCountResponseDto[];
}

export class MemberTagResponseDto {
  @ApiProperty({ example: 'at-risk' })
  name: string;

  @ApiProperty({ enum: ['SYSTEM', 'MANUAL'] })
  source: string;

  @ApiPropertyOptional({ example: '#FF5733' })
  color?: string;
}
