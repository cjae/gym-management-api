import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: '+254712345678', description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', description: 'User status', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: string;

  @ApiPropertyOptional({ example: 'MEMBER', description: 'User role', enum: ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'] })
  @IsOptional()
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'])
  role?: string;
}
