import { IsString, IsOptional } from 'class-validator';

export class CreateTrainerProfileDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  availability?: any;
}
