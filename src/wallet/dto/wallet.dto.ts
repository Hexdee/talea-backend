import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreatePayoutAccountDto {
  @ApiProperty()
  @IsString()
  bankName!: string;

  @ApiProperty()
  @IsString()
  accountName!: string;

  @ApiProperty()
  @IsString()
  accountNumberMasked!: string;

  @ApiProperty()
  @IsString()
  provider!: string;
}

export class CreatePayoutRequestDto {
  @ApiProperty()
  @IsInt()
  @Min(1000)
  amountInKobo!: number;

  @ApiProperty()
  @IsString()
  payoutAccountId!: string;
}
