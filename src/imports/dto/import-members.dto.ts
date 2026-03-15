import { ApiProperty } from '@nestjs/swagger';

export class ImportJobResponseDto {
  @ApiProperty({ example: 'uuid-here' })
  id: string;

  @ApiProperty({ example: 'MEMBERS' })
  type: string;

  @ApiProperty({ example: 'PROCESSING' })
  status: string;

  @ApiProperty({ example: 'members.csv' })
  fileName: string;

  @ApiProperty({ example: 150 })
  totalRows: number;

  @ApiProperty({ example: '2026-03-15T10:00:00.000Z' })
  createdAt: Date;
}

export class ImportJobDetailResponseDto extends ImportJobResponseDto {
  @ApiProperty({ example: 140 })
  importedCount: number;

  @ApiProperty({ example: 5 })
  skippedCount: number;

  @ApiProperty({ example: 5 })
  errorCount: number;

  @ApiProperty({
    example: [
      { row: 3, email: 'jane@example.com', reason: 'Email already exists' },
    ],
    nullable: true,
  })
  skipped: any;

  @ApiProperty({
    example: [{ row: 7, field: 'email', message: 'Invalid email format' }],
    nullable: true,
  })
  errors: any;

  @ApiProperty({ example: '2026-03-15T10:05:00.000Z', nullable: true })
  completedAt: Date | null;
}
