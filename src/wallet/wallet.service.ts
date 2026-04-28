import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LedgerEntryType,
  OnchainTransactionStatus,
  OnchainTransactionType,
  Prisma,
  PayoutRequestStatus,
  TransakOrderStatus,
  WalletTransactionType,
  WithdrawalDestinationType,
} from '@prisma/client';
import { WALLET_PROVIDER } from '../chain/wallet-provider.token';
import type { WalletProvider } from '../chain/wallet-provider.interface';
import { formatCurrency } from '../common/utils/currency';
import { EmailsService } from '../emails/emails.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransakService } from '../transak/transak.service';
import {
  CreateOnrampIntentDto,
  TransakWebhookDto,
} from '../transak/dto/transak.dto';
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
    private readonly configService: ConfigService,
    @Inject(WALLET_PROVIDER)
    private readonly walletProvider: WalletProvider,
    private readonly ledgerService: LedgerService,
    private readonly transakService: TransakService,
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
    }

    await this.prisma.userChainWallet.update({
      where: { id: chainWalletId },
      data: {
        usdcTokenAccountAddress: recent.usdcTokenAccountAddress,
        lastObservedUsdcBalanceMinor: recent.usdcBalanceInUsdcMinor,
        lastDepositSignature: orderedSignatures[orderedSignatures.length - 1],
      },
    });

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
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    const [payoutAccounts, payoutRequests, chainWallets, transakOrders] =
      await Promise.all([
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
        this.prisma.transakOrderIntent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

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
      transakOrders: transakOrders.map((order) => ({
        id: order.id,
        type: order.type,
        status: order.status,
        partnerOrderId: order.partnerOrderId,
        externalOrderId: order.externalOrderId,
        fiatCurrency: order.fiatCurrency,
        fiatAmount: order.fiatAmount,
        cryptoCurrency: order.cryptoCurrency,
        cryptoAmount: order.cryptoAmount,
        createdAt: order.createdAt,
      })),
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

  async createOnrampIntent(userId: string, dto: CreateOnrampIntentDto) {
    await this.enforceVelocity(userId, 'create onramp intent');
    const user = await this.getUserOrThrow(userId);
    const wallet = await this.getDefaultCustodialWallet(userId);
    const intent = await this.transakService.createOnrampIntent({
      userId,
      walletId: null,
      walletAddress: wallet.address,
      partnerCustomerId: user.id,
      fiatCurrency: dto.fiatCurrency,
      fiatAmount: dto.fiatAmount,
    });

    return {
      intentId: intent.id,
      partnerOrderId: intent.partnerOrderId,
      ...this.transakService.buildOnrampWidgetConfig({
        walletAddress: wallet.address,
        partnerOrderId: intent.partnerOrderId,
        partnerCustomerId: user.id,
        fiatCurrency: intent.fiatCurrency,
        fiatAmount: intent.fiatAmount,
      }),
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

      const holdIdempotency = `withdraw:hold:${userId}:${Date.now()}:${dto.amountInUsdcMinor}`;
      await this.ledgerService.postEntry({
        userId,
        idempotencyKey: holdIdempotency,
        type: LedgerEntryType.WITHDRAWAL_HOLD,
        amountInUsdcMinor: -dto.amountInUsdcMinor,
        availableDeltaInUsdcMinor: -dto.amountInUsdcMinor,
        pendingDeltaInUsdcMinor: dto.amountInUsdcMinor,
        description: 'Withdrawal hold placed',
        reference: holdIdempotency,
        mirrorWalletTransactionType: WalletTransactionType.PAYOUT_REQUEST,
      });

      const request = await this.prisma.payoutRequest.create({
        data: {
          userId,
          payoutAccountId: payoutAccount.id,
          amountInUsdcMinor: dto.amountInUsdcMinor,
          status: 'REVIEWING',
        },
      });

      const transfer = await this.walletProvider.signTransfer({
        direction: 'TREASURY_TO_EXTERNAL',
        destinationWalletAddress: payoutAccount.walletAddress,
        amountInUsdcMinor: dto.amountInUsdcMinor,
      });

      const sponsoredGas = await this.walletProvider.sponsorGas({
        txSignature: transfer.signature,
      });

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
            mirrorWalletTransactionType: WalletTransactionType.PAYOUT_COMPLETED,
          },
          tx,
        );

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

        await tx.payoutRequest.update({
          where: { id: request.id },
          data: {
            status: 'PAID',
            processedAt: new Date(),
            externalReference: transfer.signature,
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
            network: this.configService.get<string>('SOLANA_NETWORK', 'devnet'),
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
              feeInLamports: sponsoredGas.feeInLamports,
              feeInUsdcMinor: sponsoredGas.feeInUsdcMinor,
              solUsdPrice: sponsoredGas.solUsdPrice,
            },
            userId,
            payoutRequestId: request.id,
          },
        });
      });

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

    if (!this.transakService.isEnabled()) {
      throw new BadRequestException(
        'Transak off-ramp is not enabled in this environment.',
      );
    }

    const holdIdempotency = `withdraw:hold:${userId}:${Date.now()}:${dto.amountInUsdcMinor}`;
    await this.ledgerService.postEntry({
      userId,
      idempotencyKey: holdIdempotency,
      type: LedgerEntryType.WITHDRAWAL_HOLD,
      amountInUsdcMinor: -dto.amountInUsdcMinor,
      availableDeltaInUsdcMinor: -dto.amountInUsdcMinor,
      pendingDeltaInUsdcMinor: dto.amountInUsdcMinor,
      description: 'Bank withdrawal hold placed',
      reference: holdIdempotency,
      mirrorWalletTransactionType: WalletTransactionType.PAYOUT_REQUEST,
    });

    const payoutRequest = await this.prisma.payoutRequest.create({
      data: {
        userId,
        payoutAccountId: payoutAccount.id,
        amountInUsdcMinor: dto.amountInUsdcMinor,
        status: 'REVIEWING',
      },
    });

    const custodialWallet = await this.getDefaultCustodialWallet(userId);
    const offrampIntent = await this.transakService.createOfframpIntent({
      userId,
      walletId: wallet.id,
      payoutRequestId: payoutRequest.id,
      walletAddress: custodialWallet.address,
      fiatCurrency: 'USD',
      fiatAmount: (dto.amountInUsdcMinor / 1_000_000).toFixed(2),
    });

    await this.prisma.payoutRequest.update({
      where: { id: payoutRequest.id },
      data: {
        externalReference: offrampIntent.partnerOrderId,
      },
    });

    await this.emailsService.sendWithdrawalRequestedEmail({
      to: user.email,
      displayName: user.displayName,
      amountFormatted: formatCurrency(dto.amountInUsdcMinor, 'USDC'),
      destinationLabel: payoutAccount.label,
      requestId: payoutRequest.id,
    });

    return {
      id: payoutRequest.id,
      status: payoutRequest.status,
      transak: this.transakService.buildOnrampWidgetConfig({
        walletAddress: custodialWallet.address,
        partnerOrderId: offrampIntent.partnerOrderId,
        partnerCustomerId: user.id,
        fiatCurrency: 'USD',
        fiatAmount: (dto.amountInUsdcMinor / 1_000_000).toFixed(2),
      }),
    };
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

  async handleTransakWebhook(
    payload: TransakWebhookDto,
    rawBody: string,
    signature?: string,
  ) {
    this.transakService.verifyWebhookSignature(rawBody, signature ?? null);
    const eventKey =
      payload.eventId ||
      `${payload.orderId ?? ''}:${payload.partnerOrderId ?? ''}:${payload.status ?? ''}`;
    const event = await this.transakService.storeWebhookEvent({
      eventKey,
      eventType: payload.eventId,
      status: payload.status,
      signature,
      externalOrderId: payload.orderId,
      partnerOrderId: payload.partnerOrderId,
      payloadJson: payload as unknown as Prisma.InputJsonValue,
    });

    if (event.alreadyProcessed) {
      return { success: true, alreadyProcessed: true };
    }

    await this.transakService.updateIntentFromWebhook({
      partnerOrderId: payload.partnerOrderId,
      externalOrderId: payload.orderId,
      status: payload.status,
      transactionHash: payload.transactionHash,
      walletAddress: payload.walletAddress,
      cryptoCurrency: payload.cryptoCurrency,
      cryptoAmount: payload.cryptoAmount,
      fiatCurrency: payload.fiatCurrency,
      fiatAmount: payload.fiatAmount,
      payloadJson: payload as unknown as Prisma.InputJsonValue,
    });

    const intent = await this.transakService.findIntentByOrder({
      partnerOrderId: payload.partnerOrderId,
      externalOrderId: payload.orderId,
    });

    if (!intent) {
      await this.prisma.transakWebhookEvent.update({
        where: { id: event.event.id },
        data: {
          processedAt: new Date(),
          errorMessage: 'Intent not found for webhook payload.',
        },
      });
      return { success: true, matchedIntent: false };
    }

    if (
      intent.type === 'ONRAMP' &&
      intent.status === TransakOrderStatus.COMPLETED &&
      intent.walletAddress
    ) {
      await this.refreshDepositsForWalletAddress(intent.walletAddress);
    }

    if (intent.type === 'OFFRAMP' && intent.payoutRequestId) {
      const payoutRequest = intent.payoutRequest;

      if (intent.status === TransakOrderStatus.COMPLETED && payoutRequest) {
        await this.prisma.$transaction(async (tx) => {
          await this.ledgerService.postEntry(
            {
              userId: intent.userId,
              idempotencyKey: `withdraw:debit:${intent.payoutRequestId}`,
              type: LedgerEntryType.WITHDRAWAL_DEBIT,
              amountInUsdcMinor: -payoutRequest.amountInUsdcMinor,
              availableDeltaInUsdcMinor: 0,
              pendingDeltaInUsdcMinor: -payoutRequest.amountInUsdcMinor,
              description: 'Bank off-ramp withdrawal debited',
              reference: payload.orderId ?? payload.partnerOrderId,
              mirrorWalletTransactionType:
                WalletTransactionType.PAYOUT_COMPLETED,
            },
            tx,
          );

          await tx.payoutRequest.update({
            where: { id: intent.payoutRequestId! },
            data: {
              status: PayoutRequestStatus.PAID,
              processedAt: new Date(),
              externalReference: payload.orderId ?? payload.partnerOrderId,
            },
          });
        });
      }

      if (
        (intent.status === TransakOrderStatus.FAILED ||
          intent.status === TransakOrderStatus.CANCELLED) &&
        payoutRequest
      ) {
        await this.prisma.$transaction(async (tx) => {
          await this.ledgerService.postEntry(
            {
              userId: intent.userId,
              idempotencyKey: `withdraw:release:${intent.payoutRequestId}`,
              type: LedgerEntryType.WITHDRAWAL_RELEASE,
              amountInUsdcMinor: payoutRequest.amountInUsdcMinor,
              availableDeltaInUsdcMinor: payoutRequest.amountInUsdcMinor,
              pendingDeltaInUsdcMinor: -payoutRequest.amountInUsdcMinor,
              description: 'Bank withdrawal hold released',
              reference: payload.orderId ?? payload.partnerOrderId,
              mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
            },
            tx,
          );

          await tx.payoutRequest.update({
            where: { id: intent.payoutRequestId! },
            data: {
              status: PayoutRequestStatus.REJECTED,
              deadLetterReason:
                payload.status ?? 'Transak reported a failed/cancelled payout.',
              processedAt: new Date(),
            },
          });
        });
      }
    }

    await this.prisma.transakWebhookEvent.update({
      where: { id: event.event.id },
      data: {
        processedAt: new Date(),
      },
    });

    return { success: true, matchedIntent: true };
  }

  async reconcilePendingOfframps() {
    const staleAt = new Date(Date.now() - 45 * 60 * 1000);
    const deadAt = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const pending = await this.prisma.payoutRequest.findMany({
      where: {
        status: {
          in: [PayoutRequestStatus.REQUESTED, PayoutRequestStatus.REVIEWING],
        },
        requestedAt: {
          lte: staleAt,
        },
      },
      include: {
        transakOrderIntent: true,
      },
      take: 200,
    });

    let retried = 0;
    let deadLettered = 0;

    for (const request of pending) {
      if (request.requestedAt <= deadAt && request.retryCount >= 3) {
        await this.prisma.$transaction(async (tx) => {
          await this.ledgerService.postEntry(
            {
              userId: request.userId,
              idempotencyKey: `withdraw:dead-release:${request.id}`,
              type: LedgerEntryType.WITHDRAWAL_RELEASE,
              amountInUsdcMinor: request.amountInUsdcMinor,
              availableDeltaInUsdcMinor: request.amountInUsdcMinor,
              pendingDeltaInUsdcMinor: -request.amountInUsdcMinor,
              description: 'Dead-letter payout hold released',
              reference: request.externalReference ?? request.id,
              mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
            },
            tx,
          );

          await tx.payoutRequest.update({
            where: { id: request.id },
            data: {
              status: PayoutRequestStatus.DEAD_LETTER,
              deadLetterReason: 'Stuck payout exceeded retry threshold.',
              processedAt: new Date(),
            },
          });
        });
        deadLettered += 1;
        continue;
      }

      await this.prisma.payoutRequest.update({
        where: { id: request.id },
        data: {
          retryCount: {
            increment: 1,
          },
          lastRetryAt: new Date(),
          notes:
            request.transakOrderIntent?.status ??
            'Queued for reconciliation retry',
        },
      });
      retried += 1;
    }

    return {
      scanned: pending.length,
      retried,
      deadLettered,
    };
  }
}
