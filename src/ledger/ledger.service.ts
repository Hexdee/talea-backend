import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerEntryType, Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TxClient = Prisma.TransactionClient;

type PostLedgerEntryInput = {
  userId: string;
  idempotencyKey: string;
  type: LedgerEntryType;
  description: string;
  amountInUsdcMinor: number;
  availableDeltaInUsdcMinor: number;
  pendingDeltaInUsdcMinor?: number;
  reference?: string;
  metadataJson?: Prisma.InputJsonValue;
  mirrorWalletTransactionType?: WalletTransactionType;
};

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateWallet(userId: string, tx: TxClient) {
    return tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async postEntry(
    input: PostLedgerEntryInput,
    txClient?: TxClient,
  ): Promise<{
    availableBalanceInUsdcMinor: number;
    pendingBalanceInUsdcMinor: number;
  }> {
    const run = async (tx: TxClient) => {
      const existing = await tx.ledgerJournal.findUnique({
        where: {
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (existing) {
        return {
          availableBalanceInUsdcMinor: existing.availableBalanceAfterMinor,
          pendingBalanceInUsdcMinor: existing.pendingBalanceAfterMinor,
        };
      }

      const wallet = await this.getOrCreateWallet(input.userId, tx);
      const pendingDelta = input.pendingDeltaInUsdcMinor ?? 0;
      const nextAvailable =
        wallet.availableBalanceInUsdcMinor + input.availableDeltaInUsdcMinor;
      const nextPending = wallet.pendingBalanceInUsdcMinor + pendingDelta;

      if (nextAvailable < 0 || nextPending < 0) {
        throw new BadRequestException(
          'Ledger operation would result in a negative balance.',
        );
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalanceInUsdcMinor: nextAvailable,
          pendingBalanceInUsdcMinor: nextPending,
        },
      });

      await tx.ledgerJournal.create({
        data: {
          userId: input.userId,
          walletId: wallet.id,
          type: input.type,
          amountInUsdcMinor: input.amountInUsdcMinor,
          idempotencyKey: input.idempotencyKey,
          availableBalanceAfterMinor: nextAvailable,
          pendingBalanceAfterMinor: nextPending,
          reference: input.reference,
          description: input.description,
          metadataJson: input.metadataJson,
        },
      });

      if (input.mirrorWalletTransactionType) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: input.mirrorWalletTransactionType,
            amountInUsdcMinor: input.amountInUsdcMinor,
            reference: input.reference ?? input.idempotencyKey,
            description: input.description,
          },
        });
      }

      return {
        availableBalanceInUsdcMinor: nextAvailable,
        pendingBalanceInUsdcMinor: nextPending,
      };
    };

    if (txClient) {
      return run(txClient);
    }

    return this.prisma.$transaction((tx) => run(tx));
  }
}
