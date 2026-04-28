import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateOnrampIntentDto {
  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  fiatCurrency?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fiatAmount?: number;
}

export class TransakWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partnerOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cryptoCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cryptoAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fiatCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fiatAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionHash?: string;
}
