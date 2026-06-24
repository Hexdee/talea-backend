import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { WalletService } from '../wallet/wallet.service';
import {
  AddWithdrawalAllowlistEntryDto,
  RejectWithdrawalDto,
  UpdateWithdrawalPolicyDto,
} from './dto/withdrawal-policy.dto';
import { WithdrawalPolicyService } from '../withdrawal-policy/withdrawal-policy.service';

@ApiTags('admin')
@Controller('admin/withdrawal-policy')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class WithdrawalPolicyController {
  constructor(
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly walletService: WalletService,
  ) {}

  @Get()
  @Version('1')
  getPolicy() {
    return this.withdrawalPolicyService.getPolicy();
  }

  @Put()
  @Version('1')
  updatePolicy(@Body() dto: UpdateWithdrawalPolicyDto) {
    return this.withdrawalPolicyService
      .updatePolicy(dto)
      .then(() => this.withdrawalPolicyService.getPolicy());
  }

  @Post('allowlist')
  @Version('1')
  addAllowlistEntry(@Body() dto: AddWithdrawalAllowlistEntryDto) {
    return this.withdrawalPolicyService.upsertAllowlistEntry(dto);
  }

  @Delete('allowlist/:walletAddress')
  @Version('1')
  removeAllowlistEntry(@Param('walletAddress') walletAddress: string) {
    return this.withdrawalPolicyService
      .deactivateAllowlistEntry(walletAddress)
      .then(() => ({ success: true }));
  }

  @Post('payouts/:payoutRequestId/approve')
  @Version('1')
  approveWithdrawal(@Param('payoutRequestId') payoutRequestId: string) {
    return this.walletService.approvePayoutRequest(payoutRequestId);
  }

  @Post('payouts/:payoutRequestId/reject')
  @Version('1')
  rejectWithdrawal(
    @Param('payoutRequestId') payoutRequestId: string,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.walletService.rejectPayoutRequest(
      payoutRequestId,
      dto.reason ?? 'Rejected by admin.',
    );
  }
}
