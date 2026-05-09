import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookStatus,
  ChainWalletCustodyType,
  OfferType,
  SourceFormat,
} from '@prisma/client';
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
  genre?: string;

  @ApiPropertyOptional({
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  tags?: string[];

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
  @Min(1)
  priceInUsdcMinor!: number;

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

export class PublishChapterDto {
  @ApiProperty()
  @IsBoolean()
  isFree!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  priceInUsdcMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCopies?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerWalletId?: string;
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
  wordCount!: number;

  @ApiProperty()
  estimatedReadMinutes!: number;

  @ApiProperty()
  isPublished!: boolean;

  @ApiProperty()
  isUnlocked!: boolean;

  @ApiPropertyOptional()
  edition?: {
    maxCopies: number;
    mintedCopies: number;
    priceInUsdcMinor: number;
    formattedPrice: string;
  } | null;
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

  @ApiPropertyOptional()
  collection?: {
    mintAddress: string;
    metadataAddress: string;
    metadataUri?: string | null;
  } | null;

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
    priceInUsdcMinor: number;
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
  wordCount!: number;

  @ApiProperty()
  estimatedReadMinutes!: number;

  @ApiProperty()
  renderedHtml!: string;

  @ApiProperty()
  progressPercent!: number;

  @ApiPropertyOptional()
  ownership?: {
    required: boolean;
    owned: boolean;
    ownerWalletAddress?: string | null;
    editionSupply?: {
      mintedCopies: number;
      maxCopies: number;
    } | null;
  };
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

export class WalletSummaryDto {
  @ApiProperty()
  address!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    enum: ChainWalletCustodyType,
  })
  custodyType!: ChainWalletCustodyType;
}
