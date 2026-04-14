import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class QuotePurchaseDto {
  @ApiProperty()
  @IsString()
  slug!: string;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayNotEmpty()
  chapterNumbers!: number[];
}

export class CreateSolanaPaymentDto extends QuotePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletId?: string;
}

export class CompleteSolanaPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['CUSTODIAL', 'EXTERNAL'] as const)
  payerMode?: 'CUSTODIAL' | 'EXTERNAL';
}
