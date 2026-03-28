import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
} from './dto/wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@Controller('wallet')
@UseGuards(SessionAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @Version('1')
  getWallet(@CurrentUser() user: SessionUser) {
    return this.walletService.getWallet(user.id);
  }

  @Post('payout-accounts')
  @Version('1')
  createPayoutAccount(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreatePayoutAccountDto,
  ) {
    return this.walletService.createPayoutAccount(user.id, dto);
  }

  @Post('payout-requests')
  @Version('1')
  createPayoutRequest(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreatePayoutRequestDto,
  ) {
    return this.walletService.createPayoutRequest(user.id, dto);
  }
}
