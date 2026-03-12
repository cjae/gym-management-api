import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsDateString,
  IsBoolean,
  Equals,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Password (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'John', description: 'First name' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Last name' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({
    example: '+254712345678',
    description: 'Phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: '2000-03-10',
    description: 'Birthday (only month and day are used, year is ignored)',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiProperty({
    example: true,
    description: 'Must accept Terms of Service',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms of Service' })
  acceptTos: boolean;

  @ApiProperty({
    example: true,
    description: 'Must accept the gym liability waiver',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the liability waiver' })
  acceptWaiver: boolean;
}
