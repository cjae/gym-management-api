import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token from login/register' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  refreshToken: string;
}
