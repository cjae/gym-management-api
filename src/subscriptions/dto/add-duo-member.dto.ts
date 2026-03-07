import { IsEmail } from 'class-validator';

export class AddDuoMemberDto {
  @IsEmail()
  memberEmail: string;
}
