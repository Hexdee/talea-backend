import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { OpsService } from './ops.service';

@Controller('ops')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('dashboard')
  @Version('1')
  getDashboard() {
    return this.opsService.getDashboard();
  }

  @Post('reconciliation/run')
  @Version('1')
  runReconciliation() {
    return this.opsService.runReconciliationNow();
  }

  @Get('finance/export')
  @Version('1')
  @Header('Content-Type', 'text/csv')
  exportFinance(@Query('from') fromRaw: string, @Query('to') toRaw: string) {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException(
        'from and to must be valid ISO date values.',
      );
    }

    return this.opsService.exportFinance(from, to);
  }

  @Post('repair/payouts/:payoutRequestId/retry')
  @Version('1')
  retryPayout(@Param('payoutRequestId') payoutRequestId: string) {
    return this.opsService.retryPayout(payoutRequestId);
  }

  @Post('repair/onchain/:signature/confirm')
  @Version('1')
  confirmOnchain(@Param('signature') signature: string) {
    return this.opsService.repairFailedOnchainTx(signature);
  }
}
