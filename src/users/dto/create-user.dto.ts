import {
  IsEmail,
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, Gender } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John', description: 'First name' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Last name' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({
    example: 'MEMBER',
    description:
      'User role. ADMIN can create MEMBER/TRAINER. SUPER_ADMIN can also create ADMIN.',
    enum: Role,
  })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({
    example: '+254712345678',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Gender',
    enum: Gender,
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: '2000-03-10',
    description: 'Birthday (only month and day are used, year is ignored)',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;
}
