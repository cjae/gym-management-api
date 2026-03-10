import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserSubscriptionPlanDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Monthly Plan' })
  name: string;

  @ApiProperty({ example: 2500 })
  price: number;

  @ApiProperty({ example: 'KES' })
  currency: string;

  @ApiProperty({
    enum: [
      'DAILY',
      'WEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'BI_ANNUALLY',
      'ANNUALLY',
    ],
  })
  billingInterval: string;
}

export class UserSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] })
  status: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ type: UserSubscriptionPlanDto })
  plan: UserSubscriptionPlanDto;
}

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

  @ApiPropertyOptional({ nullable: true, description: 'Soft-delete timestamp' })
  deletedAt?: Date | null;

  @ApiPropertyOptional({
    type: UserSubscriptionDto,
    nullable: true,
    description: 'Active subscription, or null if none',
  })
  subscription: UserSubscriptionDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
