import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  refreshToken: string;

  @ApiProperty({
    example: 1800,
    description: 'Access token lifetime in seconds',
  })
  expiresIn: number;

  @ApiProperty({
    example: false,
    description:
      'Whether the user must change their password before proceeding',
  })
  mustChangePassword: boolean;
}
