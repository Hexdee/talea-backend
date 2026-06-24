import {
  BadRequestException,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutRequestStatus, WithdrawalAllowlistEntry } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';

export type WithdrawalPolicySnapshot = {
  id: string;
  isEnabled: boolean;
  requireAllowlistedWallets: boolean;
  manualApprovalThresholdInUsdcMinor: number;
  maxSingleWithdrawalInUsdcMinor: number;
  maxRequestsPerDayPerWallet: number;
  maxAmountPerDayPerWalletInUsdcMinor: number;
  maxRequestsPerDayGlobal: number;
  maxAmountPerDayGlobalInUsdcMinor: number;
  platformFeeBps: number;
  allowlist: WithdrawalAllowlistEntry[];
};

type UpdateWithdrawalPolicyInput = {
  isEnabled?: boolean;
  requireAllowlistedWallets?: boolean;
  manualApprovalThresholdInUsdcMinor?: number;
  maxSingleWithdrawalInUsdcMinor?: number;
  maxRequestsPerDayPerWallet?: number;
  maxAmountPerDayPerWalletInUsdcMinor?: number;
  maxRequestsPerDayGlobal?: number;
  maxAmountPerDayGlobalInUsdcMinor?: number;
  platformFeeBps?: number;
};

type AddAllowlistInput = {
  walletAddress: string;
  label: string;
  notes?: string;
};

function startOfUtcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

@Injectable()
export class WithdrawalPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getDefaultPolicy() {
    return {
      isEnabled: true,
      requireAllowlistedWallets: false,
      manualApprovalThresholdInUsdcMinor: Number(
        this.configService.get<string>(
          'RISK_MANUAL_APPROVAL_THRESHOLD_USDC_MINOR',
          '100000000',
        ),
      ),
      maxSingleWithdrawalInUsdcMinor: Number(
        this.configService.get<string>(
          'RISK_MAX_SINGLE_WITHDRAWAL_USDC_MINOR',
          '100000000',
        ),
      ),
      maxRequestsPerDayPerWallet: Number(
        this.configService.get<string>(
          'RISK_MAX_REQUESTS_PER_DAY_PER_WALLET',
          '5',
        ),
      ),
      maxAmountPerDayPerWalletInUsdcMinor: Number(
        this.configService.get<string>(
          'RISK_MAX_AMOUNT_PER_DAY_PER_WALLET_USDC_MINOR',
          '500000000',
        ),
      ),
      maxRequestsPerDayGlobal: Number(
        this.configService.get<string>(
          'RISK_MAX_REQUESTS_PER_DAY_GLOBAL',
          '50',
        ),
      ),
      maxAmountPerDayGlobalInUsdcMinor: Number(
        this.configService.get<string>(
          'RISK_MAX_AMOUNT_PER_DAY_GLOBAL_USDC_MINOR',
          '2000000000',
        ),
      ),
      platformFeeBps: Number(
        this.configService.get<string>('PLATFORM_FEE_BPS', '1000'),
      ),
    };
  }

  private validateAddress(walletAddress: string) {
    try {
      return new PublicKey(walletAddress).toBase58();
    } catch (error) {
      throw new BadRequestException(
        'A valid Solana wallet address is required.',
        { cause: error },
      );
    }
  }

  private async ensurePolicyRow() {
    const existing = await this.prisma.withdrawalPolicy.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.withdrawalPolicy.create({
      data: this.getDefaultPolicy(),
    });
  }

  async getPolicy() {
    const [policy, allowlist] = await Promise.all([
      this.ensurePolicyRow(),
      this.prisma.withdrawalAllowlistEntry.findMany({
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      ...policy,
      allowlist,
    } satisfies WithdrawalPolicySnapshot;
  }

  async updatePolicy(input: UpdateWithdrawalPolicyInput) {
    const policy = await this.ensurePolicyRow();
    return this.prisma.withdrawalPolicy.update({
      where: { id: policy.id },
      data: {
        isEnabled: input.isEnabled ?? policy.isEnabled,
        requireAllowlistedWallets:
          input.requireAllowlistedWallets ?? policy.requireAllowlistedWallets,
        manualApprovalThresholdInUsdcMinor:
          input.manualApprovalThresholdInUsdcMinor ??
          policy.manualApprovalThresholdInUsdcMinor,
        maxSingleWithdrawalInUsdcMinor:
          input.maxSingleWithdrawalInUsdcMinor ??
          policy.maxSingleWithdrawalInUsdcMinor,
        maxRequestsPerDayPerWallet:
          input.maxRequestsPerDayPerWallet ?? policy.maxRequestsPerDayPerWallet,
        maxAmountPerDayPerWalletInUsdcMinor:
          input.maxAmountPerDayPerWalletInUsdcMinor ??
          policy.maxAmountPerDayPerWalletInUsdcMinor,
        maxRequestsPerDayGlobal:
          input.maxRequestsPerDayGlobal ?? policy.maxRequestsPerDayGlobal,
        maxAmountPerDayGlobalInUsdcMinor:
          input.maxAmountPerDayGlobalInUsdcMinor ??
          policy.maxAmountPerDayGlobalInUsdcMinor,
        platformFeeBps: input.platformFeeBps ?? policy.platformFeeBps,
      },
    });
  }

  async getPlatformFeeBps() {
    const policy = await this.ensurePolicyRow();
    return policy.platformFeeBps;
  }

  async upsertAllowlistEntry(input: AddAllowlistInput) {
    const walletAddress = this.validateAddress(input.walletAddress);
    return this.prisma.withdrawalAllowlistEntry.upsert({
      where: { walletAddress },
      update: {
        label: input.label,
        notes: input.notes,
        isActive: true,
      },
      create: {
        walletAddress,
        label: input.label,
        notes: input.notes,
        isActive: true,
      },
    });
  }

  async deactivateAllowlistEntry(walletAddressRaw: string) {
    const walletAddress = this.validateAddress(walletAddressRaw);
    return this.prisma.withdrawalAllowlistEntry.update({
      where: { walletAddress },
      data: { isActive: false },
    });
  }

  async isWalletAllowlisted(walletAddress: string) {
    const normalized = this.validateAddress(walletAddress);
    const allowlist = await this.prisma.withdrawalAllowlistEntry.findUnique({
      where: { walletAddress: normalized },
    });

    return Boolean(allowlist?.isActive);
  }

  async getUsageForToday(userId: string) {
    const start = startOfUtcDay();
    const [userStats, globalStats] = await Promise.all([
      this.prisma.payoutRequest.aggregate({
        where: {
          userId,
          requestedAt: { gte: start },
          status: {
            in: [
              PayoutRequestStatus.REQUESTED,
              PayoutRequestStatus.REVIEWING,
              PayoutRequestStatus.APPROVED,
              PayoutRequestStatus.PAID,
            ],
          },
        },
        _count: {
          id: true,
        },
        _sum: {
          amountInUsdcMinor: true,
        },
      }),
      this.prisma.payoutRequest.aggregate({
        where: {
          requestedAt: { gte: start },
          status: {
            in: [
              PayoutRequestStatus.REQUESTED,
              PayoutRequestStatus.REVIEWING,
              PayoutRequestStatus.APPROVED,
              PayoutRequestStatus.PAID,
            ],
          },
        },
        _count: {
          id: true,
        },
        _sum: {
          amountInUsdcMinor: true,
        },
      }),
    ]);

    return {
      userRequestCount: userStats._count.id,
      userAmountInUsdcMinor: userStats._sum.amountInUsdcMinor ?? 0,
      globalRequestCount: globalStats._count.id,
      globalAmountInUsdcMinor: globalStats._sum.amountInUsdcMinor ?? 0,
    };
  }

  async assertWithdrawalAllowed(input: {
    userId: string;
    amountInUsdcMinor: number;
    destinationWalletAddress?: string | null;
  }) {
    const policy = await this.ensurePolicyRow();

    if (!policy.isEnabled) {
      throw new ForbiddenException('Withdrawals are currently paused.');
    }

    if (input.amountInUsdcMinor > policy.maxSingleWithdrawalInUsdcMinor) {
      throw new BadRequestException(
        'Withdrawal amount exceeds the single-withdrawal limit.',
      );
    }

    if (input.destinationWalletAddress && policy.requireAllowlistedWallets) {
      const allowlisted = await this.isWalletAllowlisted(
        input.destinationWalletAddress,
      );
      if (!allowlisted) {
        throw new ForbiddenException(
          'This withdrawal destination is not allowlisted.',
        );
      }
    }

    const usage = await this.getUsageForToday(input.userId);
    if (usage.userRequestCount >= policy.maxRequestsPerDayPerWallet) {
      throw new BadRequestException(
        'Daily withdrawal request limit reached for this wallet.',
      );
    }

    if (
      usage.userAmountInUsdcMinor + input.amountInUsdcMinor >
      policy.maxAmountPerDayPerWalletInUsdcMinor
    ) {
      throw new BadRequestException(
        'Daily withdrawal amount limit reached for this wallet.',
      );
    }

    if (usage.globalRequestCount >= policy.maxRequestsPerDayGlobal) {
      throw new BadRequestException('Daily withdrawal request limit reached.');
    }

    if (
      usage.globalAmountInUsdcMinor + input.amountInUsdcMinor >
      policy.maxAmountPerDayGlobalInUsdcMinor
    ) {
      throw new BadRequestException('Daily withdrawal amount limit reached.');
    }

    return {
      policy,
      requiresManualReview:
        input.amountInUsdcMinor >= policy.manualApprovalThresholdInUsdcMinor,
      allowlisted: input.destinationWalletAddress
        ? await this.isWalletAllowlisted(input.destinationWalletAddress)
        : false,
    };
  }
}
