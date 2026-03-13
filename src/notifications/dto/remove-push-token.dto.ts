import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemovePushTokenDto {
  @ApiProperty({
    description: 'Expo push token to remove',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  token: string;
}
