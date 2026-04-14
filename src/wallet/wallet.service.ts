import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OnchainTransactionStatus,
  OnchainTransactionType,
  WalletTransactionType,
  WithdrawalDestinationType,
} from '@prisma/client';
import { SolanaService } from '../chain/solana.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
  LinkExternalWalletDto,
  VerifyDepositDto,
} from './dto/wallet.dto';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaService: SolanaService,
  ) {}

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
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    const payoutRequests = await this.prisma.payoutRequest.findMany({
      where: { userId },
      include: {
        payoutAccount: true,
      },
      orderBy: {
        requestedAt: 'desc',
      },
    });

    const chainWallets = await this.prisma.userChainWallet.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const chainWalletPayload = await Promise.all(
      chainWallets.map(async (item) => {
        if (!item.isActive) {
          return item;
        }

        try {
          const [usdcTokenAccountAddress, usdcBalanceInUsdcMinor] =
            await Promise.all([
              this.solanaService.getAssociatedUsdcAddress(item.address),
              this.solanaService.getUsdcBalance(item.address),
            ]);

          return {
            ...item,
            usdcTokenAccountAddress,
            currentUsdcBalanceInUsdcMinor: usdcBalanceInUsdcMinor,
          };
        } catch {
          return item;
        }
      }),
    );

    return {
      wallet,
      payoutAccounts,
      payoutRequests,
      treasurySettlement: {
        network: this.solanaService.getNetwork(),
        usdcMintAddress: this.solanaService.getUsdcMintAddress(),
      },
      chainWallets: chainWalletPayload.map((item) => ({
        id: item.id,
        address: item.address,
        label: item.label,
        custodyType: item.custodyType,
        usdcTokenAccountAddress: item.usdcTokenAccountAddress,
        usdcBalanceInUsdcMinor:
          'currentUsdcBalanceInUsdcMinor' in item
            ? item.currentUsdcBalanceInUsdcMinor
            : item.lastObservedUsdcBalanceMinor,
        isDefault: item.isDefault,
        isActive: item.isActive,
        isCreatorPayoutWallet: item.isCreatorPayoutWallet,
        createdAt: item.createdAt,
      })),
    };
  }

  async linkExternalWallet(userId: string, dto: LinkExternalWalletDto) {
    if (!this.solanaService.isValidAddress(dto.address)) {
      throw new BadRequestException('Enter a valid Solana wallet address.');
    }

    const existing = await this.prisma.userChainWallet.findUnique({
      where: {
        address: dto.address,
      },
    });

    if (existing && existing.userId !== userId) {
      throw new BadRequestException(
        'That external wallet is already linked to another account.',
      );
    }

    if (dto.makeDefault) {
      await this.prisma.userChainWallet.updateMany({
        where: {
          userId,
        },
        data: {
          isDefault: false,
        },
      });
    }

    return this.prisma.userChainWallet.upsert({
      where: {
        address: dto.address,
      },
      update: {
        label: dto.label,
        isActive: true,
        isDefault: dto.makeDefault ?? false,
      },
      create: {
        userId,
        address: dto.address,
        label: dto.label,
        custodyType: 'EXTERNAL',
        isDefault: dto.makeDefault ?? false,
      },
    });
  }

  async setDefaultWallet(userId: string, walletId: string) {
    const wallet = await this.prisma.userChainWallet.findFirst({
      where: {
        id: walletId,
        userId,
        isActive: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found.');
    }

    await this.prisma.$transaction([
      this.prisma.userChainWallet.updateMany({
        where: {
          userId,
        },
        data: {
          isDefault: false,
        },
      }),
      this.prisma.userChainWallet.update({
        where: {
          id: wallet.id,
        },
        data: {
          isDefault: true,
        },
      }),
    ]);

    return { success: true };
  }

  async createPayoutAccount(userId: string, dto: CreatePayoutAccountDto) {
    if (
      dto.destinationType === WithdrawalDestinationType.SOLANA_WALLET &&
      (!dto.walletAddress ||
        !this.solanaService.isValidAddress(dto.walletAddress))
    ) {
      throw new BadRequestException(
        'A valid Solana wallet address is required for wallet withdrawals.',
      );
    }

    if (
      dto.destinationType === WithdrawalDestinationType.BANK &&
      (!dto.bankName || !dto.accountName || !dto.accountNumberMasked)
    ) {
      throw new BadRequestException(
        'Bank withdrawal destinations require bank details.',
      );
    }

    const existingAccounts = await this.prisma.payoutAccount.count({
      where: { userId },
    });

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        destinationType: dto.destinationType,
        label: dto.label,
        bankName: dto.bankName,
        accountName: dto.accountName,
        accountNumberMasked: dto.accountNumberMasked,
        provider: dto.provider,
        walletAddress: dto.walletAddress,
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

    if (wallet.availableBalanceInUsdcMinor < dto.amountInUsdcMinor) {
      throw new BadRequestException('Insufficient available balance.');
    }

    const payoutAccount = await this.prisma.payoutAccount.findFirst({
      where: {
        id: dto.payoutAccountId,
        userId,
      },
    });

    if (!payoutAccount) {
      throw new NotFoundException('Withdrawal destination not found.');
    }

    if (
      payoutAccount.destinationType === WithdrawalDestinationType.SOLANA_WALLET
    ) {
      if (!payoutAccount.walletAddress) {
        throw new BadRequestException(
          'Solana wallet withdrawal destination is missing an address.',
        );
      }

      const transfer =
        await this.solanaService.transferUsdcFromTreasuryToWallet({
          destinationWalletAddress: payoutAccount.walletAddress,
          amountInUsdcMinor: dto.amountInUsdcMinor,
        });

      return this.prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            availableBalanceInUsdcMinor: {
              decrement: dto.amountInUsdcMinor,
            },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.PAYOUT_COMPLETED,
            amountInUsdcMinor: -dto.amountInUsdcMinor,
            reference: transfer.signature,
            description:
              'External Solana wallet withdrawal completed on devnet',
          },
        });

        const request = await tx.payoutRequest.create({
          data: {
            userId,
            payoutAccountId: payoutAccount.id,
            amountInUsdcMinor: dto.amountInUsdcMinor,
            status: 'PAID',
            processedAt: new Date(),
          },
        });

        await tx.onchainTransaction.create({
          data: {
            signature: transfer.signature,
            network: this.solanaService.getNetwork(),
            txType: OnchainTransactionType.USDC_TRANSFER,
            status: OnchainTransactionStatus.CONFIRMED,
            slot: transfer.confirmationSlot ?? undefined,
            blockTime: transfer.blockTime ?? undefined,
            confirmationCommitment:
              this.solanaService.getConfirmationCommitment(),
            metadataJson: {
              purpose: 'external_wallet_withdrawal',
              sourceTokenAccountAddress: transfer.sourceTokenAccountAddress,
              destinationTokenAccountAddress:
                transfer.destinationTokenAccountAddress,
              destinationWalletAddress: payoutAccount.walletAddress,
            },
            userId,
            payoutRequestId: request.id,
          },
        });

        return request;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalanceInUsdcMinor: {
            decrement: dto.amountInUsdcMinor,
          },
          pendingBalanceInUsdcMinor: {
            increment: dto.amountInUsdcMinor,
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.PAYOUT_REQUEST,
          amountInUsdcMinor: -dto.amountInUsdcMinor,
          reference: `BANK-WD-${Date.now()}`,
          description: 'Bank withdrawal request submitted',
        },
      });

      return tx.payoutRequest.create({
        data: {
          userId,
          payoutAccountId: payoutAccount.id,
          amountInUsdcMinor: dto.amountInUsdcMinor,
          status: 'REQUESTED',
        },
      });
    });
  }

  private async getDefaultCustodialWallet(userId: string) {
    const wallet = await this.prisma.userChainWallet.findFirst({
      where: {
        userId,
        custodyType: 'CUSTODIAL',
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    if (!wallet) {
      throw new NotFoundException('Custodial Lesenpad wallet not found.');
    }

    return wallet;
  }

  async refreshDeposits(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const chainWallet = await this.getDefaultCustodialWallet(userId);
    const snapshot = await this.solanaService.getLatestDepositSnapshot(
      chainWallet.address,
    );
    const delta =
      snapshot.balanceInUsdcMinor - chainWallet.lastObservedUsdcBalanceMinor;

    if (delta <= 0 || !snapshot.signature) {
      await this.prisma.userChainWallet.update({
        where: { id: chainWallet.id },
        data: {
          usdcTokenAccountAddress: snapshot.tokenAccountAddress,
          lastObservedUsdcBalanceMinor: snapshot.balanceInUsdcMinor,
        },
      });

      return {
        detectedAmountInUsdcMinor: 0,
        balanceInUsdcMinor: snapshot.balanceInUsdcMinor,
        tokenAccountAddress: snapshot.tokenAccountAddress,
      };
    }

    const existing = await this.prisma.onchainTransaction.findUnique({
      where: { signature: snapshot.signature },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.userChainWallet.update({
        where: { id: chainWallet.id },
        data: {
          usdcTokenAccountAddress: snapshot.tokenAccountAddress,
          lastObservedUsdcBalanceMinor: snapshot.balanceInUsdcMinor,
          lastDepositSignature: snapshot.signature,
        },
      });

      if (!existing) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.DEPOSIT,
            amountInUsdcMinor: delta,
            reference: snapshot.signature!,
            description: 'Devnet USDC deposit detected',
          },
        });

        await tx.onchainTransaction.create({
          data: {
            signature: snapshot.signature!,
            network: this.solanaService.getNetwork(),
            txType: OnchainTransactionType.DEPOSIT,
            status: OnchainTransactionStatus.CONFIRMED,
            confirmationCommitment:
              this.solanaService.getConfirmationCommitment(),
            metadataJson: {
              tokenAccountAddress: snapshot.tokenAccountAddress,
              balanceInUsdcMinor: snapshot.balanceInUsdcMinor,
              detectedAmountInUsdcMinor: delta,
            },
            userId,
          },
        });
      }
    });

    return {
      detectedAmountInUsdcMinor: existing ? 0 : delta,
      balanceInUsdcMinor: snapshot.balanceInUsdcMinor,
      tokenAccountAddress: snapshot.tokenAccountAddress,
    };
  }

  async verifyDeposit(userId: string, dto: VerifyDepositDto) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const chainWallet = await this.getDefaultCustodialWallet(userId);
    const existing = await this.prisma.onchainTransaction.findUnique({
      where: { signature: dto.signature },
    });

    if (existing) {
      return {
        detectedAmountInUsdcMinor: 0,
        signature: dto.signature,
        alreadyRecorded: true,
      };
    }

    const deposit = await this.solanaService.verifyUsdcDepositSignature({
      signature: dto.signature,
      destinationOwnerAddress: chainWallet.address,
    });
    const balanceInUsdcMinor = await this.solanaService.getUsdcBalance(
      chainWallet.address,
    );
    const tokenAccountAddress =
      await this.solanaService.getAssociatedUsdcAddress(chainWallet.address);

    await this.prisma.$transaction(async (tx) => {
      await tx.userChainWallet.update({
        where: { id: chainWallet.id },
        data: {
          usdcTokenAccountAddress: tokenAccountAddress,
          lastObservedUsdcBalanceMinor: balanceInUsdcMinor,
          lastDepositSignature: dto.signature,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEPOSIT,
          amountInUsdcMinor: deposit.amountInUsdcMinor,
          reference: dto.signature,
          description: 'Verified devnet USDC deposit',
        },
      });

      await tx.onchainTransaction.create({
        data: {
          signature: dto.signature,
          network: this.solanaService.getNetwork(),
          txType: OnchainTransactionType.DEPOSIT,
          status: OnchainTransactionStatus.CONFIRMED,
          slot: deposit.confirmationSlot,
          blockTime: deposit.blockTime,
          confirmationCommitment:
            this.solanaService.getConfirmationCommitment(),
          metadataJson: {
            tokenAccountAddress,
            amountInUsdcMinor: deposit.amountInUsdcMinor,
          },
          userId,
        },
      });
    });

    return {
      detectedAmountInUsdcMinor: deposit.amountInUsdcMinor,
      balanceInUsdcMinor,
      tokenAccountAddress,
      signature: dto.signature,
      alreadyRecorded: false,
    };
  }
}
