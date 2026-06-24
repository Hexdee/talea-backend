import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateUserRolesDto {
  @ApiProperty({
    enum: Role,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  roles?: Role[];
}

export class ListAdminUsersQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  q?: string;
}
