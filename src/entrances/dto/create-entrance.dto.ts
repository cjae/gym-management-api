import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEntranceDto {
  @ApiProperty({ example: 'Front Door' })
  @IsString()
  @MaxLength(100)
  name: string;
}
