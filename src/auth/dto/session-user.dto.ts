import { ApiProperty } from '@nestjs/swagger';

export class SessionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({
    type: [String],
  })
  roles!: string[];
}
