import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  IsObject,
} from 'class-validator';

export class CreateNotificationDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(1000)
  body: string;

  @IsString()
  @MaxLength(50)
  type: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
