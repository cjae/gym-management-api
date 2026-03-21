import { ApiProperty } from '@nestjs/swagger';

export class LeaderboardMemberDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/example/image/upload/v1/avatar.jpg',
    nullable: true,
  })
  displayPicture: string | null;
}
