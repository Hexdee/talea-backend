import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LedgerEntryType,
  OnchainTransactionStatus,
  OnchainTransactionType,
  PayoutRequestStatus,
  WalletTransactionType,
  WithdrawalDestinationType,
} from '@prisma/client';
import { WALLET_PROVIDER } from '../chain/wallet-provider.token';
import type { WalletProvider } from '../chain/wallet-provider.interface';
import { formatCurrency } from '../common/utils/currency';
import { EmailsService } from '../emails/emails.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
  LinkExternalWalletDto,
  VerifyDepositDto,
} from './dto/wallet.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(WALLET_PROVIDER)
    private readonly walletProvider: WalletProvider,
    private readonly ledgerService: LedgerService,
    private readonly emailsService: EmailsService,
  ) {}

  private getRiskPerMinuteRequestLimit() {
    return Number(
      this.configService.get<string>('RISK_PER_MINUTE_REQUEST_LIMIT', '20'),
    );
  }

  private getDailyWithdrawalLimit() {
    return Number(
      this.configService.get<string>(
        'RISK_DAILY_WITHDRAWAL_LIMIT_USDC_MINOR',
        '500000000',
      ),
    );
  }

  private getEstimatedGasFeeBuffer() {
    return Number(
      this.configService.get<string>('ESTIMATED_GAS_BUFFER', '3000'),
    );
  }

  private async enforceVelocity(userId: string, action: string) {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const count = await this.prisma.ledgerJournal.count({
      where: {
        userId,
        createdAt: {
          gte: oneMinuteAgo,
        },
      },
    });

    if (count >= this.getRiskPerMinuteRequestLimit()) {
      throw new BadRequestException(
        `Rate limit exceeded for ${action}. Try again shortly.`,
      );
    }
  }

  private async enforceDailyWithdrawalLimit(
    userId: string,
    amountInUsdcMinor: number,
  ) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const aggregate = await this.prisma.ledgerJournal.aggregate({
      where: {
        userId,
        type: {
          in: [LedgerEntryType.WITHDRAWAL_DEBIT],
        },
        createdAt: {
          gte: start,
        },
      },
      _sum: {
        amountInUsdcMinor: true,
      },
    });
    const used = Math.abs(aggregate._sum.amountInUsdcMinor ?? 0);
    if (used + amountInUsdcMinor > this.getDailyWithdrawalLimit()) {
      throw new BadRequestException(
        'Daily withdrawal cap reached. Try again tomorrow or contact support.',
      );
    }
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
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

  private async refreshDepositsForChainWallet(
    userId: string,
    chainWalletId: string,
    address: string,
  ) {
    const recent = await Promise.all([
      this.prisma.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }),
      this.walletProvider.getBalances(address),
    ]).then(([, balances]) => balances);

    const recentSignatures = await this.prisma.$transaction(async (tx) => {
      const chainWallet = await tx.userChainWallet.findUnique({
        where: { id: chainWalletId },
      });

      if (!chainWallet) {
        throw new NotFoundException('Chain wallet not found.');
      }

      const signatures = await this.prisma.$queryRaw<
        Array<{ signature: string }>
      >`SELECT signature FROM "OnchainTransaction" WHERE "txType" = 'DEPOSIT' AND "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 100`;

      await tx.userChainWallet.update({
        where: { id: chainWallet.id },
        data: {
          usdcTokenAccountAddress: recent.usdcTokenAccountAddress,
          lastObservedUsdcBalanceMinor: recent.usdcBalanceInUsdcMinor,
          lastDepositSignature:
            signatures[0]?.signature ?? chainWallet.lastDepositSignature,
        },
      });

      return signatures.map((item) => item.signature);
    });

    const known = new Set(recentSignatures);
    const deposits = await this.walletProvider.getRecentUsdcDepositSignatures(
      address,
      25,
    );

    let detectedAmountInUsdcMinor = 0;
    const appliedSignatures: string[] = [];
    const orderedSignatures = [...deposits.signatures].reverse();
    for (const signature of orderedSignatures) {
      if (known.has(signature)) {
        continue;
      }

      let verification: Awaited<
        ReturnType<WalletProvider['verifyUsdcDepositSignature']>
      > | null = null;
      try {
        verification = await this.walletProvider.verifyUsdcDepositSignature({
          signature,
          destinationOwnerAddress: address,
        });
      } catch {
        verification = null;
      }

      if (!verification || verification.amountInUsdcMinor <= 0) {
        continue;
      }

      const idempotencyKey = `deposit:${signature}:${verification.tokenAccountAddress}:${verification.amountInUsdcMinor}`;
      await this.prisma.$transaction(async (tx) => {
        await this.ledgerService.postEntry(
          {
            userId,
            idempotencyKey,
            type: LedgerEntryType.DEPOSIT_CREDIT,
            amountInUsdcMinor: verification.amountInUsdcMinor,
            availableDeltaInUsdcMinor: verification.amountInUsdcMinor,
            description: 'USDC deposit confirmed onchain',
            reference: signature,
            metadataJson: {
              tokenAccountAddress: verification.tokenAccountAddress,
            },
            mirrorWalletTransactionType: WalletTransactionType.DEPOSIT,
          },
          tx,
        );

        await tx.onchainTransaction.upsert({
          where: { signature },
          update: {
            status: OnchainTransactionStatus.CONFIRMED,
            txType: OnchainTransactionType.DEPOSIT,
            metadataJson: {
              tokenAccountAddress: verification.tokenAccountAddress,
              amountInUsdcMinor: verification.amountInUsdcMinor,
            },
            userId,
          },
          create: {
            signature,
            network: this.configService.get<string>('SOLANA_NETWORK', 'devnet'),
            txType: OnchainTransactionType.DEPOSIT,
            status: OnchainTransactionStatus.CONFIRMED,
            slot: verification.confirmationSlot ?? undefined,
            blockTime: verification.blockTime ?? undefined,
            confirmationCommitment: this.configService.get<string>(
              'SOLANA_CONFIRMATION_COMMITMENT',
              'confirmed',
            ),
            metadataJson: {
              tokenAccountAddress: verification.tokenAccountAddress,
              amountInUsdcMinor: verification.amountInUsdcMinor,
            },
            userId,
          },
        });
      });

      detectedAmountInUsdcMinor += verification.amountInUsdcMinor;
      appliedSignatures.push(signature);
    }

    await this.prisma.userChainWallet.update({
      where: { id: chainWalletId },
      data: {
        usdcTokenAccountAddress: recent.usdcTokenAccountAddress,
        lastObservedUsdcBalanceMinor: recent.usdcBalanceInUsdcMinor,
        lastDepositSignature: orderedSignatures[orderedSignatures.length - 1],
      },
    });

    if (detectedAmountInUsdcMinor > 0) {
      const user = await this.getUserOrThrow(userId);
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { availableBalanceInUsdcMinor: true },
      });

      await this.emailsService.sendDepositReceivedEmail({
        to: user.email,
        displayName: user.displayName,
        amountFormatted: formatCurrency(detectedAmountInUsdcMinor, 'USDC'),
        availableBalanceFormatted: formatCurrency(
          wallet?.availableBalanceInUsdcMinor ?? 0,
          'USDC',
        ),
        reference: appliedSignatures[appliedSignatures.length - 1] ?? null,
      });
    }

    return {
      detectedAmountInUsdcMinor,
      balanceInUsdcMinor: recent.usdcBalanceInUsdcMinor,
      tokenAccountAddress: recent.usdcTokenAccountAddress,
    };
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        transactions: {
          take: 30,
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            type: true,
            amountInUsdcMinor: true,
            reference: true,
            description: true,
            createdAt: true,
          },
        },
      },
    });

    const [payoutAccounts, payoutRequests, chainWallets] = await Promise.all([
      this.prisma.payoutAccount.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.payoutRequest.findMany({
        where: { userId },
        include: {
          payoutAccount: true,
        },
        orderBy: {
          requestedAt: 'desc',
        },
      }),
      this.prisma.userChainWallet.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    const defaultCustodialWallet = chainWallets.find(
      (item) =>
        item.custodyType === 'CUSTODIAL' && item.isActive && item.isDefault,
    );
    if (defaultCustodialWallet) {
      try {
        await this.refreshDepositsForChainWallet(
          userId,
          defaultCustodialWallet.id,
          defaultCustodialWallet.address,
        );
      } catch (error) {
        this.logger.warn(
          `Deposit auto-refresh skipped for user ${userId}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    const chainWalletPayload = await Promise.all(
      chainWallets.map(async (item) => {
        if (!item.isActive) {
          return item;
        }

        try {
          const balances = await this.walletProvider.getBalances(item.address);
          return {
            ...item,
            usdcTokenAccountAddress: balances.usdcTokenAccountAddress,
            currentUsdcBalanceInUsdcMinor: balances.usdcBalanceInUsdcMinor,
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
        network: this.configService.get<string>('SOLANA_NETWORK', 'devnet'),
        usdcMintAddress: this.configService.get<string>(
          'SOLANA_USDC_MINT_ADDRESS',
          '',
        ),
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
    if (!dto.address?.trim()) {
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
      !dto.walletAddress
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
    await this.enforceVelocity(userId, 'create payout request');
    await this.enforceDailyWithdrawalLimit(userId, dto.amountInUsdcMinor);

    const user = await this.getUserOrThrow(userId);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found.');
    }

    if (
      wallet.availableBalanceInUsdcMinor <
      dto.amountInUsdcMinor + this.getEstimatedGasFeeBuffer()
    ) {
      throw new BadRequestException(
        'Insufficient available balance for amount + sponsored gas.',
      );
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

      const request = await this.prisma.$transaction(async (tx) => {
        const request = await tx.payoutRequest.create({
          data: {
            userId,
            payoutAccountId: payoutAccount.id,
            amountInUsdcMinor: dto.amountInUsdcMinor,
            status: 'REVIEWING',
          },
        });

        const holdIdempotency = `withdraw:hold:${request.id}`;
        await this.ledgerService.postEntry(
          {
            userId,
            idempotencyKey: holdIdempotency,
            type: LedgerEntryType.WITHDRAWAL_HOLD,
            amountInUsdcMinor: -dto.amountInUsdcMinor,
            availableDeltaInUsdcMinor: -dto.amountInUsdcMinor,
            pendingDeltaInUsdcMinor: dto.amountInUsdcMinor,
            description: 'Withdrawal hold placed',
            reference: request.id,
            mirrorWalletTransactionType: WalletTransactionType.PAYOUT_REQUEST,
          },
          tx,
        );

        return request;
      });

      let transfer: Awaited<ReturnType<WalletProvider['signTransfer']>> | null =
        null;
      let sponsoredGas: Awaited<
        ReturnType<WalletProvider['sponsorGas']>
      > | null = null;

      try {
        transfer = await this.walletProvider.signTransfer({
          direction: 'TREASURY_TO_EXTERNAL',
          destinationWalletAddress: payoutAccount.walletAddress,
          amountInUsdcMinor: dto.amountInUsdcMinor,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        await this.prisma.$transaction(async (tx) => {
          await this.ledgerService.postEntry(
            {
              userId,
              idempotencyKey: `withdraw:release:${request.id}`,
              type: LedgerEntryType.WITHDRAWAL_RELEASE,
              amountInUsdcMinor: dto.amountInUsdcMinor,
              availableDeltaInUsdcMinor: dto.amountInUsdcMinor,
              pendingDeltaInUsdcMinor: -dto.amountInUsdcMinor,
              description: 'Withdrawal hold released',
              reference: request.id,
              mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
              metadataJson: {
                failureReason: message,
              },
            },
            tx,
          );

          await tx.payoutRequest.update({
            where: { id: request.id },
            data: {
              status: PayoutRequestStatus.DEAD_LETTER,
              processedAt: new Date(),
              deadLetterReason: message,
            },
          });
        });

        throw error;
      }

      try {
        sponsoredGas = await this.walletProvider.sponsorGas({
          txSignature: transfer.signature,
        });
      } catch (error) {
        this.logger.warn(
          `Withdrawal gas sponsorship/quote failed for request ${request.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }. Continuing without charging gas.`,
        );
        sponsoredGas = null;
      }

      if (!transfer) {
        throw new Error('Withdrawal transfer missing.');
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await this.ledgerService.postEntry(
            {
              userId,
              idempotencyKey: `withdraw:debit:${request.id}`,
              type: LedgerEntryType.WITHDRAWAL_DEBIT,
              amountInUsdcMinor: -dto.amountInUsdcMinor,
              availableDeltaInUsdcMinor: 0,
              pendingDeltaInUsdcMinor: -dto.amountInUsdcMinor,
              description: 'External Solana withdrawal debited',
              reference: transfer.signature,
              mirrorWalletTransactionType:
                WalletTransactionType.PAYOUT_COMPLETED,
            },
            tx,
          );

          if (sponsoredGas?.feeInUsdcMinor) {
            await this.ledgerService.postEntry(
              {
                userId,
                idempotencyKey: `gas:withdraw:${request.id}`,
                type: LedgerEntryType.GAS_FEE_DEBIT,
                amountInUsdcMinor: -sponsoredGas.feeInUsdcMinor,
                availableDeltaInUsdcMinor: -sponsoredGas.feeInUsdcMinor,
                description: 'Treasury-sponsored gas fee charged',
                reference: transfer.signature,
                metadataJson: {
                  feeInLamports: sponsoredGas.feeInLamports,
                  solUsdPrice: sponsoredGas.solUsdPrice,
                },
                mirrorWalletTransactionType: WalletTransactionType.GAS_FEE,
              },
              tx,
            );
          }

          await tx.payoutRequest.update({
            where: { id: request.id },
            data: {
              status: 'PAID',
              processedAt: new Date(),
              externalReference: transfer.signature,
              deadLetterReason: null,
            },
          });

          await tx.onchainTransaction.upsert({
            where: {
              signature: transfer.signature,
            },
            update: {
              status: OnchainTransactionStatus.CONFIRMED,
              txType: OnchainTransactionType.USDC_TRANSFER,
            },
            create: {
              signature: transfer.signature,
              network: this.configService.get<string>(
                'SOLANA_NETWORK',
                'devnet',
              ),
              txType: OnchainTransactionType.USDC_TRANSFER,
              status: OnchainTransactionStatus.CONFIRMED,
              slot: transfer.confirmationSlot ?? undefined,
              blockTime: transfer.blockTime ?? undefined,
              confirmationCommitment: this.configService.get<string>(
                'SOLANA_CONFIRMATION_COMMITMENT',
                'confirmed',
              ),
              metadataJson: {
                purpose: 'external_wallet_withdrawal',
                sourceTokenAccountAddress: transfer.sourceTokenAccountAddress,
                destinationTokenAccountAddress:
                  transfer.destinationTokenAccountAddress,
                destinationWalletAddress: payoutAccount.walletAddress,
                feeInLamports:
                  sponsoredGas?.feeInLamports ?? transfer.feeInLamports,
                feeInUsdcMinor: sponsoredGas?.feeInUsdcMinor ?? null,
                solUsdPrice: sponsoredGas?.solUsdPrice ?? null,
              },
              userId,
              payoutRequestId: request.id,
            },
          });
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        await this.prisma.payoutRequest.update({
          where: { id: request.id },
          data: {
            status: PayoutRequestStatus.DEAD_LETTER,
            processedAt: new Date(),
            externalReference: transfer.signature,
            deadLetterReason: message,
          },
        });

        throw error;
      }

      await this.emailsService.sendWithdrawalCompletedEmail({
        to: user.email,
        displayName: user.displayName,
        amountFormatted: formatCurrency(dto.amountInUsdcMinor, 'USDC'),
        destinationLabel: payoutAccount.label,
        reference: transfer.signature,
      });

      return {
        id: request.id,
        status: PayoutRequestStatus.PAID,
        reference: transfer.signature,
      };
    }

    if (payoutAccount.destinationType === WithdrawalDestinationType.BANK) {
      throw new BadRequestException('Bank withdrawals are coming soon.');
    }

    throw new BadRequestException('Unsupported withdrawal destination.');
  }

  async refreshDeposits(userId: string) {
    const chainWallet = await this.getDefaultCustodialWallet(userId);
    return this.refreshDepositsForChainWallet(
      userId,
      chainWallet.id,
      chainWallet.address,
    );
  }

  async refreshDepositsForWalletAddress(walletAddress: string) {
    const chainWallet = await this.prisma.userChainWallet.findUnique({
      where: { address: walletAddress },
      select: { id: true, userId: true, address: true },
    });

    if (!chainWallet) {
      throw new NotFoundException('Wallet address is not linked to any user.');
    }

    return this.refreshDepositsForChainWallet(
      chainWallet.userId,
      chainWallet.id,
      chainWallet.address,
    );
  }

  async refreshDepositsForAllUsers(limit = 250) {
    const wallets = await this.prisma.userChainWallet.findMany({
      where: {
        custodyType: 'CUSTODIAL',
        isActive: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        address: true,
      },
    });

    let creditedAmount = 0;
    for (const wallet of wallets) {
      const result = await this.refreshDepositsForChainWallet(
        wallet.userId,
        wallet.id,
        wallet.address,
      );
      creditedAmount += result.detectedAmountInUsdcMinor;
    }

    return {
      scannedWallets: wallets.length,
      creditedAmountInUsdcMinor: creditedAmount,
    };
  }

  async verifyDeposit(userId: string, dto: VerifyDepositDto) {
    const chainWallet = await this.getDefaultCustodialWallet(userId);
    const verification = await this.walletProvider.verifyUsdcDepositSignature({
      signature: dto.signature,
      destinationOwnerAddress: chainWallet.address,
    });

    const idempotencyKey = `deposit:${dto.signature}:${verification.tokenAccountAddress}:${verification.amountInUsdcMinor}`;
    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.postEntry(
        {
          userId,
          idempotencyKey,
          type: LedgerEntryType.DEPOSIT_CREDIT,
          amountInUsdcMinor: verification.amountInUsdcMinor,
          availableDeltaInUsdcMinor: verification.amountInUsdcMinor,
          description: 'Verified USDC deposit',
          reference: dto.signature,
          metadataJson: {
            tokenAccountAddress: verification.tokenAccountAddress,
          },
          mirrorWalletTransactionType: WalletTransactionType.DEPOSIT,
        },
        tx,
      );

      await tx.onchainTransaction.upsert({
        where: { signature: dto.signature },
        update: {
          status: OnchainTransactionStatus.CONFIRMED,
          txType: OnchainTransactionType.DEPOSIT,
          userId,
        },
        create: {
          signature: dto.signature,
          network: this.configService.get<string>('SOLANA_NETWORK', 'devnet'),
          txType: OnchainTransactionType.DEPOSIT,
          status: OnchainTransactionStatus.CONFIRMED,
          slot: verification.confirmationSlot ?? undefined,
          blockTime: verification.blockTime ?? undefined,
          confirmationCommitment: this.configService.get<string>(
            'SOLANA_CONFIRMATION_COMMITMENT',
            'confirmed',
          ),
          metadataJson: {
            tokenAccountAddress: verification.tokenAccountAddress,
            amountInUsdcMinor: verification.amountInUsdcMinor,
          },
          userId,
        },
      });
    });

    const latest = await this.walletProvider.getBalances(chainWallet.address);
    await this.prisma.userChainWallet.update({
      where: { id: chainWallet.id },
      data: {
        usdcTokenAccountAddress: latest.usdcTokenAccountAddress,
        lastObservedUsdcBalanceMinor: latest.usdcBalanceInUsdcMinor,
        lastDepositSignature: dto.signature,
      },
    });

    return {
      detectedAmountInUsdcMinor: verification.amountInUsdcMinor,
      balanceInUsdcMinor: latest.usdcBalanceInUsdcMinor,
      tokenAccountAddress: latest.usdcTokenAccountAddress,
      signature: dto.signature,
      alreadyRecorded: false,
    };
  }

  async reconcilePendingOfframps() {
    return {
      scanned: 0,
      retried: 0,
      deadLettered: 0,
    };
  }
}
