import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'admin@gym.co.ke' })
  email: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  phone?: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'] })
  role: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiPropertyOptional({
    enum: ['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY'],
  })
  gender?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
  })
  displayPicture?: string;

  @ApiPropertyOptional({ example: '2000-03-10', description: 'Birthday' })
  birthday?: Date;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
