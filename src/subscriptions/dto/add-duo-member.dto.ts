import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddDuoMemberDto {
  @ApiProperty({ example: 'partner@example.com' })
  @IsEmail()
  memberEmail: string;
}
