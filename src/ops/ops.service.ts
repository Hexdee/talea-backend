import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliationService: ReconciliationService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboard() {
    const [
      pendingPayouts,
      stuckChainTx,
      deadLetterPayouts,
      recentPayoutRequests,
      recentFailedOnchainTxs,
    ] = await Promise.all([
      this.prisma.payoutRequest.count({
        where: {
          status: {
            in: ['REQUESTED', 'REVIEWING', 'APPROVED'],
          },
        },
      }),
      this.prisma.onchainTransaction.count({
        where: {
          status: 'FAILED',
        },
      }),
      this.prisma.payoutRequest.count({
        where: {
          status: 'DEAD_LETTER',
        },
      }),
      this.prisma.payoutRequest.findMany({
        where: {
          status: {
            in: ['REQUESTED', 'REVIEWING', 'APPROVED', 'DEAD_LETTER'],
          },
        },
        orderBy: {
          requestedAt: 'desc',
        },
        take: 10,
        include: {
          user: {
            select: {
              displayName: true,
              email: true,
            },
          },
          payoutAccount: {
            select: {
              label: true,
              destinationType: true,
              walletAddress: true,
              bankName: true,
            },
          },
        },
      }),
      this.prisma.onchainTransaction.findMany({
        where: {
          status: 'FAILED',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        include: {
          user: {
            select: {
              displayName: true,
              email: true,
            },
          },
          payoutRequest: {
            select: {
              id: true,
              status: true,
              requestedAt: true,
              amountInUsdcMinor: true,
            },
          },
        },
      }),
    ]);

    const ledgerMismatches = await this.prisma.$queryRaw<
      Array<{ mismatch_count: bigint }>
    >`
      SELECT COUNT(*)::bigint AS mismatch_count
      FROM "Wallet" w
      LEFT JOIN (
        SELECT "walletId",
          MAX("availableBalanceAfterMinor") AS latest_available,
          MAX("pendingBalanceAfterMinor") AS latest_pending
        FROM "LedgerJournal"
        GROUP BY "walletId"
      ) lj ON lj."walletId" = w.id
      WHERE (lj.latest_available IS NOT NULL AND lj.latest_available <> w."availableBalanceInUsdcMinor")
         OR (lj.latest_pending IS NOT NULL AND lj.latest_pending <> w."pendingBalanceInUsdcMinor")
    `;

    return {
      ledgerMismatchCount: Number(ledgerMismatches[0]?.mismatch_count ?? 0n),
      pendingPayoutCount: pendingPayouts,
      failedWebhookCount: 0,
      failedOnchainTxCount: stuckChainTx,
      deadLetterPayoutCount: deadLetterPayouts,
      treasurySecretSource: this.configService.get<string>(
        'SOLANA_TREASURY_SECRET_SOURCE',
        'file',
      ),
      hashicorpVaultConfigured:
        Boolean(this.configService.get<string>('HASHICORP_VAULT_ADDR')?.trim()) &&
        Boolean(
          this.configService.get<string>('HASHICORP_VAULT_SECRET_PATH')?.trim(),
        ),
      recentPayoutRequests,
      recentFailedOnchainTxs,
    };
  }

  async runReconciliationNow() {
    return this.reconciliationService.runScheduledPass();
  }

  async exportFinance(from: Date, to: Date) {
    const entries = await this.prisma.ledgerJournal.findMany({
      where: {
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      include: {
        user: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const header = [
      'createdAt',
      'userEmail',
      'userName',
      'type',
      'amountInUsdcMinor',
      'reference',
      'idempotencyKey',
      'description',
    ];
    const rows = entries.map((item) => [
      item.createdAt.toISOString(),
      item.user.email,
      item.user.displayName,
      item.type,
      String(item.amountInUsdcMinor),
      item.reference ?? '',
      item.idempotencyKey,
      item.description.replaceAll(',', ';'),
    ]);

    return [header, ...rows].map((row) => row.join(',')).join('\n');
  }

  async retryPayout(payoutRequestId: string) {
    return this.reconciliationService.recoverPayoutRequest(payoutRequestId);
  }

  async repairFailedOnchainTx(signature: string) {
    const tx = await this.prisma.onchainTransaction.findUnique({
      where: { signature },
    });

    if (!tx) {
      return { success: false, message: 'Onchain transaction not found.' };
    }

    await this.prisma.onchainTransaction.update({
      where: { signature },
      data: {
        status: 'CONFIRMED',
        errorPayload: Prisma.JsonNull,
      },
    });

    return { success: true };
  }
}
