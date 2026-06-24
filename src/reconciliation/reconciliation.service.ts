import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;
  private bootstrapTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly lockId = 941_202_001;

  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private isEnabled() {
    return (
      this.configService.get<string>('RECONCILIATION_ENABLED', 'true') ===
      'true'
    );
  }

  private getIntervalMs() {
    const raw = Number(
      this.configService.get<string>('RECONCILIATION_INTERVAL_SECONDS', '300'),
    );
    const seconds = Number.isFinite(raw) ? Math.max(30, raw) : 300;
    return seconds * 1000;
  }

  private getInitialDelayMs() {
    const raw = Number(
      this.configService.get<string>(
        'RECONCILIATION_INITIAL_DELAY_SECONDS',
        '20',
      ),
    );
    const seconds = Number.isFinite(raw) ? Math.max(1, raw) : 20;
    return seconds * 1000;
  }

  private async tryAcquireLock() {
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${this.lockId}) AS locked
    `;
    return Boolean(rows[0]?.locked);
  }

  private async releaseLock() {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(${this.lockId})
    `;
  }

  onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.log('Reconciliation worker is disabled.');
      return;
    }

    this.bootstrapTimer = setTimeout(() => {
      void this.runScheduledPass();
    }, this.getInitialDelayMs());

    this.timer = setInterval(() => {
      void this.runScheduledPass();
    }, this.getIntervalMs());
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runScheduledPass() {
    if (!this.isEnabled()) {
      return { skipped: true, reason: 'disabled' };
    }

    if (this.running) {
      return { skipped: true, reason: 'in-process' };
    }

    const lockAcquired = await this.tryAcquireLock();
    if (!lockAcquired) {
      return { skipped: true, reason: 'lock-not-acquired' };
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
    } catch (error) {
      this.logger.error(
        `Reconciliation pass failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    } finally {
      this.running = false;
      await this.releaseLock();
    }
  }

  async recoverPayoutRequest(payoutRequestId: string) {
    return this.walletService.recoverPayoutRequest(payoutRequestId);
  }
}
