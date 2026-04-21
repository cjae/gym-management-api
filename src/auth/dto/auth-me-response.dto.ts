import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthMeResponseDto extends UserResponseDto {
  @ApiProperty({
    description:
      'True once the member has submitted POST /auth/me/onboarding. Required before creating goals.',
  })
  onboardingCompleted: boolean;
}
