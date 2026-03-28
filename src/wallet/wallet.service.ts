import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
} from './dto/wallet.dto';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        transactions: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    const payoutAccounts = await this.prisma.payoutAccount.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const payoutRequests = await this.prisma.payoutRequest.findMany({
      where: { userId },
      orderBy: {
        requestedAt: 'desc',
      },
    });

    return {
      wallet,
      payoutAccounts,
      payoutRequests,
    };
  }

  async createPayoutAccount(userId: string, dto: CreatePayoutAccountDto) {
    const existingAccounts = await this.prisma.payoutAccount.count({
      where: { userId },
    });

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        bankName: dto.bankName,
        accountName: dto.accountName,
        accountNumberMasked: dto.accountNumberMasked,
        provider: dto.provider,
        isDefault: existingAccounts === 0,
      },
    });
  }

  async createPayoutRequest(userId: string, dto: CreatePayoutRequestDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found.');
    }

    if (wallet.availableBalanceInKobo < dto.amountInKobo) {
      throw new BadRequestException('Insufficient available balance.');
    }

    const payoutAccount = await this.prisma.payoutAccount.findFirst({
      where: {
        id: dto.payoutAccountId,
        userId,
      },
    });

    if (!payoutAccount) {
      throw new NotFoundException('Payout account not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalanceInKobo: {
            decrement: dto.amountInKobo,
          },
          pendingBalanceInKobo: {
            increment: dto.amountInKobo,
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.PAYOUT_REQUEST,
          amountInKobo: -dto.amountInKobo,
          reference: `PAYOUT-${Date.now()}`,
          description: 'Payout request submitted',
        },
      });

      return tx.payoutRequest.create({
        data: {
          userId,
          payoutAccountId: payoutAccount.id,
          amountInKobo: dto.amountInKobo,
        },
      });
    });
  }
}
