import { IsString, IsUUID, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendEmailDto {
  @ApiProperty({ format: 'uuid', description: 'Target user ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'Your membership update', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    example: 'We wanted to let you know about an update to your membership.',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;
}
