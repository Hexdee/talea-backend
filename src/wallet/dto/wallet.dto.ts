import { ApiProperty } from '@nestjs/swagger';
import { WithdrawalDestinationType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class LinkExternalWalletDto {
  @ApiProperty()
  @IsString()
  address!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

export class RegisterEmbeddedWalletDto {
  @ApiProperty()
  @IsString()
  address!: string;

  @ApiProperty()
  @IsString()
  providerWalletId!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

export class SetDefaultWalletDto {
  @ApiProperty()
  @IsString()
  walletId!: string;
}

export class CreatePayoutAccountDto {
  @ApiProperty({
    enum: WithdrawalDestinationType,
  })
  @IsEnum(WithdrawalDestinationType)
  destinationType!: WithdrawalDestinationType;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accountName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accountNumberMasked?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  walletAddress?: string;
}

export class CreatePayoutRequestDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  amountInUsdcMinor!: number;

  @ApiProperty()
  @IsString()
  payoutAccountId!: string;
}

export class VerifyDepositDto {
  @ApiProperty()
  @IsString()
  signature!: string;
}
