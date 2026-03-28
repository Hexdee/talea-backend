import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { formatCurrency } from '../common/utils/currency';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDemoPaymentDto } from './dto/payment.dto';

function buildReference() {
  return `TAL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDemoIntent(userId: string, dto: CreateDemoPaymentDto) {
    const requestedOfferIds = Array.from(
      new Set(
        (dto.offerIds?.length
          ? dto.offerIds
          : dto.offerId
            ? [dto.offerId]
            : []
        ).filter(Boolean),
      ),
    );

    if (requestedOfferIds.length === 0) {
      throw new BadRequestException('At least one offer must be selected.');
    }

    const offers = await this.prisma.offer.findMany({
      where: {
        id: {
          in: requestedOfferIds,
        },
      },
      include: {
        book: true,
      },
    });

    if (offers.length !== requestedOfferIds.length) {
      throw new NotFoundException(
        'One or more selected offers could not be found.',
      );
    }

    if (offers.some((offer) => !offer.isActive)) {
      throw new BadRequestException('Only active offers can be purchased.');
    }

    const uniqueBookIds = new Set(offers.map((offer) => offer.bookId));
    if (uniqueBookIds.size > 1) {
      throw new BadRequestException(
        'All selected offers must belong to one book.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const order = await this.prisma.order.create({
      data: {
        userId,
        customerEmail: user.email,
        totalAmountInKobo: offers.reduce(
          (sum, offer) => sum + offer.priceInKobo,
          0,
        ),
        items: {
          create: offers.map((offer) => ({
            offerId: offer.id,
            amountInKobo: offer.priceInKobo,
          })),
        },
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        reference: buildReference(),
        orderId: order.id,
        amountInKobo: order.totalAmountInKobo,
        currency: order.currency,
        provider: 'demo',
        providerPayload: {
          stage: 'pending',
          mode: 'local-demo',
        },
      },
    });

    return {
      reference: payment.reference,
      status: payment.status,
      checkoutUrl: `/checkout?reference=${payment.reference}`,
    };
  }

  async completeDemoIntent(userId: string, reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: {
        order: {
          include: {
            items: {
              include: {
                offer: {
                  include: {
                    book: true,
                  },
                },
              },
            },
            user: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    if (payment.order.userId !== userId) {
      throw new ForbiddenException('You cannot complete this payment.');
    }

    if (payment.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending demo payments can be completed.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          providerPayload: {
            stage: 'completed',
            mode: 'local-demo',
          },
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: 'COMPLETED',
        },
      });

      for (const item of payment.order.items) {
        await tx.entitlement.upsert({
          where: {
            userId_bookId_offerId: {
              userId,
              bookId: item.offer.bookId,
              offerId: item.offerId,
            },
          },
          update: {},
          create: {
            userId,
            bookId: item.offer.bookId,
            offerId: item.offerId,
            chapterStart: item.offer.chapterStart,
            chapterEnd: item.offer.chapterEnd,
            fullBook: item.offer.type === 'FULL_BOOK',
          },
        });

        await tx.libraryItem.upsert({
          where: {
            userId_bookId: {
              userId,
              bookId: item.offer.bookId,
            },
          },
          update: {},
          create: {
            userId,
            bookId: item.offer.bookId,
          },
        });

        const wallet = await tx.wallet.upsert({
          where: {
            userId: item.offer.book.authorId,
          },
          update: {
            availableBalanceInKobo: {
              increment: item.amountInKobo,
            },
          },
          create: {
            userId: item.offer.book.authorId,
            availableBalanceInKobo: item.amountInKobo,
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.SALE,
            amountInKobo: item.amountInKobo,
            reference: payment.reference,
            description: `Sale for ${item.offer.book.title} · ${item.offer.title}`,
          },
        });

        await tx.analyticsSnapshot.upsert({
          where: {
            bookId_date: {
              bookId: item.offer.bookId,
              date: new Date(new Date().toDateString()),
            },
          },
          update: {
            purchases: {
              increment: 1,
            },
            revenueInKobo: {
              increment: item.amountInKobo,
            },
          },
          create: {
            bookId: item.offer.bookId,
            date: new Date(new Date().toDateString()),
            purchases: 1,
            revenueInKobo: item.amountInKobo,
          },
        });
      }
    });

    return {
      reference,
      status: 'SUCCEEDED',
      formattedAmount: formatCurrency(payment.amountInKobo, payment.currency),
    };
  }

  async getPurchaseHistory(userId: string) {
    return this.prisma.order.findMany({
      where: {
        userId,
      },
      include: {
        payment: true,
        items: {
          include: {
            offer: {
              include: {
                book: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
