import { IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(200)
  token: string;

  @IsString()
  @MaxLength(10)
  platform: string; // ios, android
}
