import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckInDto {
  @ApiProperty({ example: 'abc123hexcode' })
  @IsString()
  qrCode: string;
}
