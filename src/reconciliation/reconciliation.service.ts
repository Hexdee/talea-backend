import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly walletService: WalletService) {}

  onModuleInit() {
    this.timer = setInterval(
      () => {
        void this.runScheduledPass();
      },
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runScheduledPass() {
    if (this.running) {
      return { skipped: true };
    }

    this.running = true;
    try {
      const [depositResult, payoutResult] = await Promise.all([
        this.walletService.refreshDepositsForAllUsers(300),
        this.walletService.reconcilePendingOfframps(),
      ]);

      this.logger.log(
        `Reconciliation pass complete. Wallets scanned: ${depositResult.scannedWallets}, credited: ${depositResult.creditedAmountInUsdcMinor}, payouts retried: ${payoutResult.retried}, dead-lettered: ${payoutResult.deadLettered}`,
      );

      return {
        deposits: depositResult,
        payouts: payoutResult,
      };
    } finally {
      this.running = false;
    }
  }
}
