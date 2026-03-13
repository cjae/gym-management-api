import { PartialType } from '@nestjs/swagger';
import { CreateGymClassDto } from './create-gym-class.dto';

export class UpdateGymClassDto extends PartialType(CreateGymClassDto) {}
