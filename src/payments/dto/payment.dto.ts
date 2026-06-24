import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class QuotePurchaseDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiPropertyOptional({ description: 'Optional offer id to purchase.' })
  @IsOptional()
  @IsString()
  offerId?: string;

  @ApiPropertyOptional({ type: [Number] })
  @ValidateIf((value: QuotePurchaseDto) => !value.offerId)
  @IsArray()
  @ArrayNotEmpty()
  chapterNumbers?: number[];
}

export class CreateSolanaPaymentDto extends QuotePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletAddress?: string;
}

export class CompleteSolanaPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chainTxSignature?: string;
}
