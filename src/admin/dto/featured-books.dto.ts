import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class UpdateFeaturedBooksDto {
  @IsArray()
  @ArrayMaxSize(24)
  @ArrayUnique()
  @IsString({ each: true })
  bookIds: string[] = [];
}
