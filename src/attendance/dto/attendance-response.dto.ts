import { ApiProperty } from '@nestjs/swagger';

export class AttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  checkInDate: Date;

  @ApiProperty()
  checkInTime: Date;
}
