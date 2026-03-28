import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookStatus, OfferType, SourceFormat } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpsertBookDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  synopsis!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImageUrl?: string;
}

export class UpsertOfferDto {
  @ApiProperty()
  @IsEnum(OfferType)
  type!: OfferType;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsInt()
  @Min(100)
  priceInKobo!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  chapterStart?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  chapterEnd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ChapterChecklistItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty()
  @IsBoolean()
  done!: boolean;
}

export class UpsertChapterDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  chapterNumber!: number;

  @ApiProperty({
    enum: SourceFormat,
  })
  @IsEnum(SourceFormat)
  draftFormat!: SourceFormat;

  @ApiProperty()
  @IsString()
  draftContent!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  authorNotes?: string;

  @ApiPropertyOptional({
    type: [ChapterChecklistItemDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ChapterChecklistItemDto)
  checklistItems?: ChapterChecklistItemDto[];
}

export class ReorderChaptersDto {
  @ApiProperty({
    type: [String],
  })
  @IsString({ each: true })
  chapterIds!: string[];
}

export class PublicBookChapterDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  chapterNumber!: number;

  @ApiProperty()
  isFree!: boolean;

  @ApiProperty()
  isPublished!: boolean;

  @ApiProperty()
  isUnlocked!: boolean;
}

export class PublicBookDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  genre!: string;

  @ApiProperty({
    type: [String],
  })
  tags!: string[];

  @ApiProperty()
  synopsis!: string;

  @ApiPropertyOptional()
  coverImageUrl?: string | null;

  @ApiProperty({
    enum: BookStatus,
  })
  status!: BookStatus;

  @ApiProperty()
  authorName!: string;

  @ApiProperty({
    type: [PublicBookChapterDto],
  })
  chapters!: PublicBookChapterDto[];

  @ApiProperty({
    type: [Object],
  })
  offers!: Array<{
    id: string;
    type: OfferType;
    title: string;
    description: string;
    formattedPrice: string;
  }>;
}

export class ReaderChapterDto {
  @ApiProperty()
  bookTitle!: string;

  @ApiProperty()
  chapterTitle!: string;

  @ApiProperty()
  chapterNumber!: number;

  @ApiProperty()
  renderedHtml!: string;

  @ApiProperty()
  progressPercent!: number;
}

export class UpsertProgressDto {
  @ApiProperty()
  @IsString()
  bookId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  currentChapterNumber!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  currentPage!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent!: number;
}
