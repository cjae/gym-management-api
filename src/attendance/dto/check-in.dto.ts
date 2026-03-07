import { IsString } from 'class-validator';

export class CheckInDto {
  @IsString()
  qrCode: string;
}
