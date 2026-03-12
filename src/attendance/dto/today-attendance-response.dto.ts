import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AttendanceMemberDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  email: string;
}

class AttendanceEntranceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class TodayAttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  memberId: string;

  @ApiProperty()
  checkInDate: Date;

  @ApiProperty()
  checkInTime: Date;

  @ApiPropertyOptional({ format: 'uuid' })
  entranceId?: string;

  @ApiProperty({ type: AttendanceMemberDto })
  member: AttendanceMemberDto;

  @ApiPropertyOptional({ type: AttendanceEntranceDto })
  entrance?: AttendanceEntranceDto;
}
