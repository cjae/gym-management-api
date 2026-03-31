import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTagDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Member IDs to assign the tag to',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberIds: string[];
}
