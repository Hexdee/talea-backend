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
import { SolanaService } from '../chain/solana.service';
import { WithdrawalPolicyService } from '../withdrawal-policy/withdrawal-policy.service';
import {
  CreatePayoutAccountDto,
  CreatePayoutRequestDto,
  LinkExternalWalletDto,
  RegisterEmbeddedWalletDto,
  VerifyDepositDto,
} from './dto/wallet.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly solanaService: SolanaService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
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
        custodyType: 'EXTERNAL',
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    if (!wallet) {
      throw new NotFoundException('Linked Lesenpad wallet not found.');
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
            network: this.configService.get<string>(
              'SOLANA_NETWORK',
              'mainnet-beta',
            ),
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
        item.custodyType === 'EXTERNAL' && item.isActive && item.isDefault,
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
        network: this.configService.get<string>(
          'SOLANA_NETWORK',
          'mainnet-beta',
        ),
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
        providerWalletId: item.providerWalletId,
        usdcTokenAccountAddress: item.usdcTokenAccountAddress,
        usdcBalanceInUsdcMinor:
          'currentUsdcBalanceInUsdcMinor' in item
            ? item.currentUsdcBalanceInUsdcMinor
            : item.lastObservedUsdcBalanceMinor,
        isDefault: item.isDefault,
        isActive: item.isActive,
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

  async linkEmbeddedWallet(userId: string, dto: RegisterEmbeddedWalletDto) {
    if (!dto.address?.trim()) {
      throw new BadRequestException(
        'Enter a valid Crossmint embedded wallet address.',
      );
    }

    if (!dto.providerWalletId?.trim()) {
      throw new BadRequestException('Enter a valid Crossmint wallet identity.');
    }

    const existing = await this.prisma.userChainWallet.findUnique({
      where: {
        address: dto.address,
      },
    });

    if (existing && existing.userId !== userId) {
      throw new BadRequestException(
        'That embedded wallet is already linked to another account.',
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
        providerWalletId: dto.providerWalletId,
        custodyType: 'EMBEDDED',
        isActive: true,
        isDefault: dto.makeDefault ?? false,
      },
      create: {
        userId,
        address: dto.address,
        label: dto.label,
        providerWalletId: dto.providerWalletId,
        custodyType: 'EMBEDDED',
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

  private async finalizeRecoveredWithdrawal(input: {
    requestId: string;
    userId: string;
    amountInUsdcMinor: number;
    signature: string;
    slot: number | null;
    blockTime: Date | null;
    feeInLamports: number;
    walletAddress?: string | null;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.postEntry(
        {
          userId: input.userId,
          idempotencyKey: `withdraw:debit:${input.requestId}`,
          type: LedgerEntryType.WITHDRAWAL_DEBIT,
          amountInUsdcMinor: -input.amountInUsdcMinor,
          availableDeltaInUsdcMinor: -input.amountInUsdcMinor,
          description: 'External Solana withdrawal debited',
          reference: input.signature,
          mirrorWalletTransactionType: WalletTransactionType.PAYOUT_COMPLETED,
        },
        tx,
      );

      await tx.payoutRequest.update({
        where: { id: input.requestId },
        data: {
          status: PayoutRequestStatus.PAID,
          processedAt: new Date(),
          externalReference: input.signature,
          deadLetterReason: null,
        },
      });

      await tx.onchainTransaction.upsert({
        where: {
          signature: input.signature,
        },
        update: {
          status: OnchainTransactionStatus.CONFIRMED,
          txType: OnchainTransactionType.USDC_TRANSFER,
          payoutRequestId: input.requestId,
          userId: input.userId,
        },
        create: {
          signature: input.signature,
          network: this.configService.get<string>(
            'SOLANA_NETWORK',
            'mainnet-beta',
          ),
          txType: OnchainTransactionType.USDC_TRANSFER,
          status: OnchainTransactionStatus.CONFIRMED,
          slot: input.slot ?? undefined,
          blockTime: input.blockTime ?? undefined,
          confirmationCommitment: this.configService.get<string>(
            'SOLANA_CONFIRMATION_COMMITMENT',
            'confirmed',
          ),
          metadataJson: {
            purpose: 'external_wallet_withdrawal',
            destinationWalletAddress: input.walletAddress,
            feeInLamports: input.feeInLamports,
          },
          userId: input.userId,
          payoutRequestId: input.requestId,
        },
      });
    });

    return {
      success: true,
      signature: input.signature,
    };
  }

  async recoverPayoutRequest(payoutRequestId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
      include: {
        user: true,
        payoutAccount: true,
      },
    });

    if (!payout) {
      return { success: false, message: 'Payout request not found.' };
    }

    if (payout.status === PayoutRequestStatus.PAID) {
      return { success: true, message: 'Payout already completed.' };
    }

    if (
      payout.payoutAccount?.destinationType !==
      WithdrawalDestinationType.SOLANA_WALLET
    ) {
      return {
        success: false,
        message: 'Only Solana wallet payouts can be chain-recovered.',
      };
    }

    const payoutAccount = payout.payoutAccount;
    const walletAddress = payoutAccount.walletAddress;
    if (!walletAddress) {
      return {
        success: false,
        message: 'Withdrawal destination is missing a Solana wallet address.',
      };
    }

    await this.prisma.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: PayoutRequestStatus.REVIEWING,
        retryCount: {
          increment: 1,
        },
        lastRetryAt: new Date(),
        deadLetterReason: null,
      },
    });

    if (payout.externalReference) {
      const status = await this.solanaService.getTransactionStatus(
        payout.externalReference,
      );
      if (status.exists) {
        return this.finalizeRecoveredWithdrawal({
          requestId: payout.id,
          userId: payout.userId,
          amountInUsdcMinor: payout.amountInUsdcMinor,
          signature: payout.externalReference,
          slot: status.slot,
          blockTime: status.blockTime,
          feeInLamports: status.feeInLamports,
          walletAddress,
        });
      }
    }

    const treasuryAddress = await this.solanaService.getTreasuryAddress();
    const matched = await this.solanaService.findRecentUsdcWithdrawalTransfer({
      sourceOwnerAddress: treasuryAddress,
      destinationOwnerAddress: walletAddress,
      amountInUsdcMinor: payout.amountInUsdcMinor,
      limit: 25,
    });

    if (matched) {
      return this.finalizeRecoveredWithdrawal({
        requestId: payout.id,
        userId: payout.userId,
        amountInUsdcMinor: payout.amountInUsdcMinor,
        signature: matched.signature,
        slot: matched.confirmationSlot,
        blockTime: matched.blockTime,
        feeInLamports: matched.feeInLamports,
        walletAddress,
      });
    }

    return {
      success: false,
      message:
        'No matching onchain withdrawal was found yet. Leave the request in REVIEWING and retry later.',
    };
  }

  private async releaseWithdrawalHold(input: {
    userId: string;
    requestId: string;
    amountInUsdcMinor: number;
    reason: string;
    txClient?: Parameters<LedgerService['postEntry']>[1];
  }) {
    const post = async (tx: NonNullable<typeof input.txClient>) =>
      this.ledgerService.postEntry(
        {
          userId: input.userId,
          idempotencyKey: `withdraw:release:${input.requestId}`,
          type: LedgerEntryType.WITHDRAWAL_RELEASE,
          amountInUsdcMinor: input.amountInUsdcMinor,
          availableDeltaInUsdcMinor: input.amountInUsdcMinor,
          pendingDeltaInUsdcMinor: -input.amountInUsdcMinor,
          description: 'Withdrawal hold released',
          reference: input.requestId,
          mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
          metadataJson: {
            failureReason: input.reason,
          },
        },
        tx,
      );

    if (input.txClient) {
      return post(input.txClient);
    }

    return this.prisma.$transaction((tx) => post(tx));
  }

  private async processPayoutExecution(payoutRequestId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
      include: {
        user: true,
        payoutAccount: true,
      },
    });

    if (!payout) {
      throw new NotFoundException('Payout request not found.');
    }

    if (payout.status === PayoutRequestStatus.PAID) {
      return {
        success: true,
        message: 'Payout already completed.',
      };
    }

    if (
      payout.payoutAccount?.destinationType !==
      WithdrawalDestinationType.SOLANA_WALLET
    ) {
      throw new BadRequestException(
        'Only Solana wallet payouts can be processed automatically.',
      );
    }

    const walletAddress = payout.payoutAccount.walletAddress;
    if (!walletAddress) {
      throw new BadRequestException(
        'Solana wallet withdrawal destination is missing an address.',
      );
    }
    const payoutAccount = payout.payoutAccount;

    const user = payout.user;
    let transfer: Awaited<ReturnType<WalletProvider['signTransfer']>> | null =
      null;
    let sponsoredGas: Awaited<ReturnType<WalletProvider['sponsorGas']>> | null =
      null;

    try {
      transfer = await this.walletProvider.signTransfer({
        direction: 'TREASURY_TO_EXTERNAL',
        destinationWalletAddress: walletAddress,
        amountInUsdcMinor: payout.amountInUsdcMinor,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.$transaction(async (tx) => {
        await this.releaseWithdrawalHold({
          userId: payout.userId,
          requestId: payout.id,
          amountInUsdcMinor: payout.amountInUsdcMinor,
          reason: message,
          txClient: tx,
        });
        await tx.payoutRequest.update({
          where: { id: payout.id },
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
        `Withdrawal gas sponsorship/quote failed for request ${payout.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }. Continuing without charging gas.`,
      );
      sponsoredGas = null;
    }

    if (!transfer) {
      throw new Error('Withdrawal transfer missing.');
    }
    const transferSignature = transfer.signature;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.ledgerService.postEntry(
          {
            userId: payout.userId,
            idempotencyKey: `withdraw:debit:${payout.id}`,
            type: LedgerEntryType.WITHDRAWAL_DEBIT,
            amountInUsdcMinor: -payout.amountInUsdcMinor,
            availableDeltaInUsdcMinor: 0,
            pendingDeltaInUsdcMinor: -payout.amountInUsdcMinor,
            description: 'External Solana withdrawal debited',
            reference: transferSignature,
            mirrorWalletTransactionType: WalletTransactionType.PAYOUT_COMPLETED,
          },
          tx,
        );

        if (sponsoredGas?.feeInUsdcMinor) {
          await this.ledgerService.postEntry(
            {
              userId: payout.userId,
              idempotencyKey: `gas:withdraw:${payout.id}`,
              type: LedgerEntryType.GAS_FEE_DEBIT,
              amountInUsdcMinor: -sponsoredGas.feeInUsdcMinor,
              availableDeltaInUsdcMinor: -sponsoredGas.feeInUsdcMinor,
              description: 'Treasury-sponsored gas fee charged',
              reference: transferSignature,
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
          where: { id: payout.id },
          data: {
            status: PayoutRequestStatus.PAID,
            processedAt: new Date(),
            externalReference: transferSignature,
            deadLetterReason: null,
          },
        });

        await tx.onchainTransaction.upsert({
          where: {
            signature: transferSignature,
          },
          update: {
            status: OnchainTransactionStatus.CONFIRMED,
            txType: OnchainTransactionType.USDC_TRANSFER,
          },
          create: {
            signature: transferSignature,
            network: this.configService.get<string>(
              'SOLANA_NETWORK',
              'mainnet-beta',
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
              destinationWalletAddress: walletAddress,
              feeInLamports:
                sponsoredGas?.feeInLamports ?? transfer.feeInLamports,
              feeInUsdcMinor: sponsoredGas?.feeInUsdcMinor ?? null,
              solUsdPrice: sponsoredGas?.solUsdPrice ?? null,
            },
            userId: payout.userId,
            payoutRequestId: payout.id,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.$transaction(async (tx) => {
        await this.releaseWithdrawalHold({
          userId: payout.userId,
          requestId: payout.id,
          amountInUsdcMinor: payout.amountInUsdcMinor,
          reason: message,
          txClient: tx,
        });
        await tx.payoutRequest.update({
          where: { id: payout.id },
          data: {
            status: PayoutRequestStatus.DEAD_LETTER,
            processedAt: new Date(),
            externalReference: transferSignature,
            deadLetterReason: message,
          },
        });
      });

      throw error;
    }

    await this.emailsService.sendWithdrawalCompletedEmail({
      to: user.email,
      displayName: user.displayName,
      amountFormatted: formatCurrency(payout.amountInUsdcMinor, 'USDC'),
      destinationLabel: payoutAccount.label,
      reference: transferSignature,
    });

    return {
      success: true,
      signature: transferSignature,
    };
  }

  async createPayoutRequest(userId: string, dto: CreatePayoutRequestDto) {
    await this.enforceVelocity(userId, 'create payout request');

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

      const policyDecision =
        await this.withdrawalPolicyService.assertWithdrawalAllowed({
          userId,
          amountInUsdcMinor: dto.amountInUsdcMinor,
          destinationWalletAddress: payoutAccount.walletAddress,
        });

      const request = await this.prisma.$transaction(async (tx) => {
        const request = await tx.payoutRequest.create({
          data: {
            userId,
            payoutAccountId: payoutAccount.id,
            amountInUsdcMinor: dto.amountInUsdcMinor,
            status: 'REVIEWING',
            notes: policyDecision.requiresManualReview
              ? 'Manual approval required by withdrawal policy.'
              : null,
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

      await this.emailsService.sendWithdrawalRequestedEmail({
        to: user.email,
        displayName: user.displayName,
        amountFormatted: formatCurrency(dto.amountInUsdcMinor, 'USDC'),
        destinationLabel: payoutAccount.label,
        requestId: request.id,
      });

      if (policyDecision.requiresManualReview) {
        return {
          id: request.id,
          status: PayoutRequestStatus.REVIEWING,
          reference: null,
        };
      }

      const result = await this.processPayoutExecution(request.id);
      return {
        id: request.id,
        status: PayoutRequestStatus.PAID,
        reference: result.signature,
      };
    }

    if (payoutAccount.destinationType === WithdrawalDestinationType.BANK) {
      throw new BadRequestException('Bank withdrawals are coming soon.');
    }

    throw new BadRequestException('Unsupported withdrawal destination.');
  }

  async approvePayoutRequest(payoutRequestId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
    });

    if (!payout) {
      return { success: false, message: 'Payout request not found.' };
    }

    if (payout.status === PayoutRequestStatus.PAID) {
      return { success: true, message: 'Payout already completed.' };
    }

    await this.prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data: {
        status: PayoutRequestStatus.APPROVED,
        deadLetterReason: null,
      },
    });

    return this.processPayoutExecution(payoutRequestId);
  }

  async rejectPayoutRequest(payoutRequestId: string, reason: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
      include: {
        user: true,
      },
    });

    if (!payout) {
      return { success: false, message: 'Payout request not found.' };
    }

    if (payout.status === PayoutRequestStatus.PAID) {
      return {
        success: false,
        message: 'Completed payouts cannot be rejected.',
      };
    }

    if (
      payout.status === PayoutRequestStatus.REQUESTED ||
      payout.status === PayoutRequestStatus.REVIEWING ||
      payout.status === PayoutRequestStatus.APPROVED
    ) {
      await this.releaseWithdrawalHold({
        userId: payout.userId,
        requestId: payout.id,
        amountInUsdcMinor: payout.amountInUsdcMinor,
        reason,
      });
    }

    await this.prisma.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: PayoutRequestStatus.REJECTED,
        processedAt: new Date(),
        deadLetterReason: reason,
      },
    });

    return { success: true, message: 'Payout rejected.' };
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
        custodyType: 'EXTERNAL',
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
          network: this.configService.get<string>(
            'SOLANA_NETWORK',
            'mainnet-beta',
          ),
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

  reconcilePendingOfframps(): Promise<{
    scanned: number;
    retried: number;
    deadLettered: number;
  }> {
    return this.prisma.payoutRequest
      .findMany({
        where: {
          status: {
            in: [
              PayoutRequestStatus.REVIEWING,
              PayoutRequestStatus.DEAD_LETTER,
            ],
          },
        },
        orderBy: { requestedAt: 'asc' },
        take: 25,
      })
      .then(async (requests) => {
        let retried = 0;
        let deadLettered = 0;

        for (const request of requests) {
          const result = await this.recoverPayoutRequest(request.id);
          if (result.success) {
            retried += 1;
          } else if (request.status === PayoutRequestStatus.DEAD_LETTER) {
            deadLettered += 1;
          }
        }

        return {
          scanned: requests.length,
          retried,
          deadLettered,
        };
      });
  }
}
