import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { CreateOnrampIntentDto } from '../transak/dto/transak.dto';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
  LinkExternalWalletDto,
  SetDefaultWalletDto,
  VerifyDepositDto,
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

  @Post('chain-wallets/external')
  @Version('1')
  linkExternalWallet(
    @CurrentUser() user: SessionUser,
    @Body() dto: LinkExternalWalletDto,
  ) {
    return this.walletService.linkExternalWallet(user.id, dto);
  }

  @Patch('chain-wallets/default')
  @Version('1')
  setDefaultWallet(
    @CurrentUser() user: SessionUser,
    @Body() dto: SetDefaultWalletDto,
  ) {
    return this.walletService.setDefaultWallet(user.id, dto.walletId);
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

  @Post('deposits/refresh')
  @Version('1')
  refreshDeposits(@CurrentUser() user: SessionUser) {
    return this.walletService.refreshDeposits(user.id);
  }

  @Post('deposits/verify')
  @Version('1')
  verifyDeposit(
    @CurrentUser() user: SessionUser,
    @Body() dto: VerifyDepositDto,
  ) {
    return this.walletService.verifyDeposit(user.id, dto);
  }

  @Post('transak/onramp-intents')
  @Version('1')
  createOnrampIntent(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateOnrampIntentDto,
  ) {
    return this.walletService.createOnrampIntent(user.id, dto);
  }
}
