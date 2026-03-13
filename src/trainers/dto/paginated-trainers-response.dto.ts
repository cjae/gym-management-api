import { ApiProperty } from '@nestjs/swagger';
import { TrainerProfileResponseDto } from './trainer-profile-response.dto';

export class PaginatedTrainersResponseDto {
  @ApiProperty({ type: [TrainerProfileResponseDto] })
  data: TrainerProfileResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
