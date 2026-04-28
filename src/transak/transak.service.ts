import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TransakOrderStatus, TransakOrderType } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

function buildPartnerOrderId(prefix: 'onramp' | 'offramp', userId: string) {
  return `lp-${prefix}-${userId.slice(0, 10)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function mapWebhookStatusToOrderStatus(status?: string): TransakOrderStatus {
  const value = status?.trim().toUpperCase();

  if (!value) {
    return TransakOrderStatus.PENDING;
  }

  if (['COMPLETED', 'SUCCESS', 'ORDER_COMPLETED'].includes(value)) {
    return TransakOrderStatus.COMPLETED;
  }

  if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(value)) {
    return value.startsWith('CANCEL')
      ? TransakOrderStatus.CANCELLED
      : TransakOrderStatus.FAILED;
  }

  if (['PENDING', 'PROCESSING', 'AWAITING_PAYMENT'].includes(value)) {
    return TransakOrderStatus.PENDING;
  }

  return TransakOrderStatus.PENDING;
}

@Injectable()
export class TransakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  isEnabled() {
    return (
      this.configService.get<string>('TRANSAK_ENABLED', 'false') === 'true'
    );
  }

  private getApiKey() {
    return this.configService.get<string>('TRANSAK_API_KEY');
  }

  private getWebhookSecret() {
    return this.configService.get<string>('TRANSAK_WEBHOOK_SECRET');
  }

  createOnrampIntent(params: {
    userId: string;
    walletId: string | null;
    walletAddress: string;
    partnerCustomerId: string;
    fiatCurrency?: string;
    fiatAmount?: number;
  }) {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Transak is disabled for this environment.',
      );
    }

    const fiatCurrency = (params.fiatCurrency ?? 'USD').toUpperCase();
    const fiatAmount = (params.fiatAmount ?? 25).toFixed(2);
    const partnerOrderId = buildPartnerOrderId('onramp', params.userId);

    return this.prisma.transakOrderIntent.create({
      data: {
        userId: params.userId,
        walletId: params.walletId,
        type: TransakOrderType.ONRAMP,
        status: TransakOrderStatus.CREATED,
        partnerOrderId,
        walletAddress: params.walletAddress,
        fiatCurrency,
        fiatAmount,
        cryptoCurrency: 'USDC',
        payloadJson: {
          partnerCustomerId: params.partnerCustomerId,
          disableWalletAddressForm: true,
        },
      },
    });
  }

  createOfframpIntent(params: {
    userId: string;
    walletId: string | null;
    payoutRequestId: string;
    walletAddress: string;
    fiatCurrency?: string;
    fiatAmount?: string;
  }) {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Transak is disabled for this environment.',
      );
    }

    const partnerOrderId = buildPartnerOrderId('offramp', params.userId);

    return this.prisma.transakOrderIntent.create({
      data: {
        userId: params.userId,
        walletId: params.walletId,
        payoutRequestId: params.payoutRequestId,
        type: TransakOrderType.OFFRAMP,
        status: TransakOrderStatus.CREATED,
        partnerOrderId,
        walletAddress: params.walletAddress,
        fiatCurrency: params.fiatCurrency?.toUpperCase(),
        fiatAmount: params.fiatAmount,
        cryptoCurrency: 'USDC',
      },
    });
  }

  buildOnrampWidgetConfig(input: {
    walletAddress: string;
    partnerOrderId: string;
    partnerCustomerId: string;
    fiatCurrency?: string | null;
    fiatAmount?: string | null;
  }) {
    return {
      transakApiKey: this.getApiKey(),
      environment: this.configService.get<string>(
        'TRANSAK_ENVIRONMENT',
        'STAGING',
      ),
      widgetUrl: this.configService.get<string>(
        'TRANSAK_WIDGET_URL',
        'https://global.transak.com',
      ),
      config: {
        walletAddress: input.walletAddress,
        partnerOrderId: input.partnerOrderId,
        partnerCustomerId: input.partnerCustomerId,
        cryptoCurrencyCode: 'USDC',
        disableWalletAddressForm: true,
        network: 'solana',
        fiatCurrency: input.fiatCurrency ?? 'USD',
        fiatAmount: input.fiatAmount ?? '25.00',
      },
    };
  }

  verifyWebhookSignature(rawBody: string, providedSignature?: string | null) {
    if (!this.isEnabled()) {
      return true;
    }

    const secret = this.getWebhookSecret();
    if (!secret) {
      throw new BadRequestException(
        'Transak webhook secret is not configured.',
      );
    }

    const signature = providedSignature?.trim().replace(/^sha256=/i, '');
    if (!signature) {
      throw new BadRequestException('Missing Transak webhook signature.');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const safeExpected = Buffer.from(expected);
    const safeProvided = Buffer.from(signature.toLowerCase());

    if (
      safeExpected.length !== safeProvided.length ||
      !timingSafeEqual(safeExpected, safeProvided)
    ) {
      throw new BadRequestException('Invalid Transak webhook signature.');
    }

    return true;
  }

  async storeWebhookEvent(params: {
    eventKey: string;
    eventType?: string;
    status?: string;
    signature?: string;
    externalOrderId?: string;
    partnerOrderId?: string;
    payloadJson: Prisma.InputJsonValue;
  }) {
    const existing = await this.prisma.transakWebhookEvent.findUnique({
      where: {
        eventKey: params.eventKey,
      },
    });

    if (existing) {
      return {
        alreadyProcessed: true,
        event: existing,
      };
    }

    const event = await this.prisma.transakWebhookEvent.create({
      data: {
        eventKey: params.eventKey,
        eventType: params.eventType,
        status: params.status,
        signature: params.signature,
        externalOrderId: params.externalOrderId,
        partnerOrderId: params.partnerOrderId,
        payloadJson: params.payloadJson,
      },
    });

    return {
      alreadyProcessed: false,
      event,
    };
  }

  updateIntentFromWebhook(params: {
    partnerOrderId?: string;
    externalOrderId?: string;
    status?: string;
    transactionHash?: string;
    walletAddress?: string;
    cryptoCurrency?: string;
    cryptoAmount?: string;
    fiatCurrency?: string;
    fiatAmount?: string;
    payloadJson: Prisma.InputJsonValue;
  }) {
    const mappedStatus = mapWebhookStatusToOrderStatus(params.status);

    return this.prisma.transakOrderIntent.updateMany({
      where: {
        OR: [
          params.externalOrderId
            ? { externalOrderId: params.externalOrderId }
            : undefined,
          params.partnerOrderId
            ? { partnerOrderId: params.partnerOrderId }
            : undefined,
        ].filter((item) =>
          Boolean(item),
        ) as Prisma.TransakOrderIntentWhereInput[],
      },
      data: {
        status: mappedStatus,
        externalOrderId: params.externalOrderId,
        transactionHash: params.transactionHash,
        walletAddress: params.walletAddress,
        cryptoCurrency: params.cryptoCurrency ?? 'USDC',
        cryptoAmount: params.cryptoAmount,
        fiatCurrency: params.fiatCurrency,
        fiatAmount: params.fiatAmount,
        payloadJson: params.payloadJson,
        lastReconciledAt: new Date(),
      },
    });
  }

  findIntentByOrder(params: {
    partnerOrderId?: string;
    externalOrderId?: string;
  }) {
    return this.prisma.transakOrderIntent.findFirst({
      where: {
        OR: [
          params.externalOrderId
            ? { externalOrderId: params.externalOrderId }
            : undefined,
          params.partnerOrderId
            ? { partnerOrderId: params.partnerOrderId }
            : undefined,
        ].filter((item) =>
          Boolean(item),
        ) as Prisma.TransakOrderIntentWhereInput[],
      },
      include: {
        payoutRequest: true,
      },
    });
  }
}
