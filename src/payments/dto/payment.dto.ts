import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class CreateDemoPaymentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  offerId!: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  offerIds?: string[];
}
