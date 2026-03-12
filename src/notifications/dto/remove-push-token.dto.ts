import { IsString, MaxLength } from 'class-validator';

export class RemovePushTokenDto {
  @IsString()
  @MaxLength(200)
  token: string;
}
