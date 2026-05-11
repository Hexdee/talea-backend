import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryType,
  OnchainTransactionStatus,
  OnchainTransactionType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { BooksService } from '../books/books.service';
import { PriceQuoteService } from '../chain/price-quote.service';
import { SolanaService } from '../chain/solana.service';
import { formatCurrency } from '../common/utils/currency';
import { EmailsService } from '../emails/emails.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompleteSolanaPaymentDto,
  CreateSolanaPaymentDto,
  QuotePurchaseDto,
} from './dto/payment.dto';

function buildReference() {
  return `LSP-LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function allocateProportionalAmounts(
  totalAmountInUsdcMinor: number,
  weights: number[],
) {
  const normalizedWeights = weights.map((weight) => Math.max(0, weight));
  const totalWeight = normalizedWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  );

  if (totalAmountInUsdcMinor <= 0) {
    return normalizedWeights.map(() => 0);
  }

  if (totalWeight <= 0) {
    return normalizedWeights.map(() => 0);
  }

  const allocations = normalizedWeights.map((weight) =>
    Math.floor((totalAmountInUsdcMinor * weight) / totalWeight),
  );
  let remainder =
    totalAmountInUsdcMinor - allocations.reduce((sum, value) => sum + value, 0);

  for (let index = 0; remainder > 0 && index < allocations.length; index += 1) {
    allocations[index] += 1;
    remainder -= 1;
  }

  return allocations;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booksService: BooksService,
    private readonly solanaService: SolanaService,
    private readonly priceQuoteService: PriceQuoteService,
    private readonly ledgerService: LedgerService,
    private readonly emailsService: EmailsService,
  ) {}

  private getDailyPurchaseLimit() {
    return Number(
      process.env.RISK_DAILY_PURCHASE_LIMIT_USDC_MINOR ?? '200000000',
    );
  }

  private getPerMinuteLimit() {
    return Number(process.env.RISK_PER_MINUTE_REQUEST_LIMIT ?? '20');
  }

  private blockedWalletSet() {
    return new Set(
      (process.env.RISK_BLOCKED_WALLET_ADDRESSES ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => Boolean(item)),
    );
  }

  private async enforceVelocityAndCaps(
    userId: string,
    amountInUsdcMinor: number,
  ) {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const minuteCount = await this.prisma.ledgerJournal.count({
      where: {
        userId,
        createdAt: {
          gte: oneMinuteAgo,
        },
      },
    });
    if (minuteCount >= this.getPerMinuteLimit()) {
      throw new BadRequestException(
        'Too many wallet operations in a short window. Try again shortly.',
      );
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const aggregate = await this.prisma.ledgerJournal.aggregate({
      where: {
        userId,
        type: LedgerEntryType.PURCHASE_DEBIT,
        createdAt: {
          gte: dayStart,
        },
      },
      _sum: {
        amountInUsdcMinor: true,
      },
    });
    const spentToday = Math.abs(aggregate._sum.amountInUsdcMinor ?? 0);
    if (spentToday + amountInUsdcMinor > this.getDailyPurchaseLimit()) {
      throw new BadRequestException(
        'Daily purchase limit reached. Try again tomorrow or contact support.',
      );
    }
  }

  private async buildPurchaseContext(userId: string, dto: QuotePurchaseDto) {
    const book = await this.prisma.book.findUnique({
      where: {
        slug: dto.slug,
      },
      include: {
        author: true,
        offers: {
          where: {
            isActive: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        chapters: {
          include: {
            edition: true,
            offer: true,
          },
          orderBy: {
            chapterNumber: 'asc',
          },
        },
      },
    });

    if (!book) {
      throw new NotFoundException('Book not found.');
    }

    const ownedTokens = await this.prisma.chapterToken.findMany({
      where: {
        ownerUserId: userId,
        chapter: {
          bookId: book.id,
        },
      },
      select: {
        chapterId: true,
      },
    });
    const ownedChapterIds = new Set(
      ownedTokens.map((token) => token.chapterId),
    );

    const selectedOffer = dto.offerId
      ? (book.offers.find((offer) => offer.id === dto.offerId) ?? null)
      : null;

    if (dto.offerId && !selectedOffer) {
      throw new BadRequestException('Offer not found for this book.');
    }

    const selectedChapterNumbers = !dto.offerId
      ? Array.from(new Set(dto.chapterNumbers ?? [])).sort(
          (left, right) => left - right,
        )
      : null;

    if (
      !dto.offerId &&
      (!selectedChapterNumbers || selectedChapterNumbers.length === 0)
    ) {
      throw new BadRequestException(
        'Select one or more chapter numbers to purchase.',
      );
    }

    const coveredChapters = selectedOffer
      ? selectedOffer.type === 'FULL_BOOK'
        ? book.status !== 'COMPLETED'
          ? (() => {
              throw new BadRequestException(
                'Full book offers can only be purchased once the story is completed.',
              );
            })()
          : book.chapters.filter(
              (chapter) =>
                chapter.publishedAt && !chapter.isFree && chapter.edition,
            )
        : selectedOffer.type === 'CHAPTER_BUNDLE'
          ? (() => {
              if (
                typeof selectedOffer.chapterStart !== 'number' ||
                typeof selectedOffer.chapterEnd !== 'number'
              ) {
                throw new BadRequestException(
                  'Bundle offer is missing its chapter range.',
                );
              }
              return book.chapters.filter(
                (chapter) =>
                  chapter.chapterNumber >= selectedOffer.chapterStart! &&
                  chapter.chapterNumber <= selectedOffer.chapterEnd!,
              );
            })()
          : (() => {
              if (
                typeof selectedOffer.chapterStart !== 'number' ||
                typeof selectedOffer.chapterEnd !== 'number' ||
                selectedOffer.chapterStart !== selectedOffer.chapterEnd
              ) {
                throw new BadRequestException(
                  'Single chapter offer is missing its chapter number.',
                );
              }
              const match = book.chapters.find(
                (chapter) =>
                  chapter.chapterNumber === selectedOffer.chapterStart,
              );
              return match ? [match] : [];
            })()
      : selectedChapterNumbers!
          .map((chapterNumber) =>
            book.chapters.find(
              (chapter) => chapter.chapterNumber === chapterNumber,
            ),
          )
          .filter((chapter): chapter is NonNullable<typeof chapter> =>
            Boolean(chapter),
          );

    if (coveredChapters.length === 0) {
      throw new BadRequestException(
        'No chapters matched this purchase request.',
      );
    }

    if (
      selectedChapterNumbers &&
      coveredChapters.length !== selectedChapterNumbers.length
    ) {
      throw new BadRequestException(
        'One or more selected chapters do not exist.',
      );
    }

    const paidCovered = coveredChapters.filter((chapter) => !chapter.isFree);
    if (paidCovered.length === 0) {
      throw new BadRequestException('Only paid chapters require purchase.');
    }

    const unavailableChapter = paidCovered.find(
      (chapter) => !chapter.publishedAt || !chapter.edition,
    );
    if (unavailableChapter) {
      throw new BadRequestException(
        `Chapter ${unavailableChapter.chapterNumber} is not published for sale yet.`,
      );
    }

    const remainingChapters = paidCovered.filter(
      (chapter) => !ownedChapterIds.has(chapter.id),
    );
    if (remainingChapters.length === 0) {
      throw new BadRequestException(
        selectedOffer
          ? 'You already own everything in this offer.'
          : 'You already own every selected chapter.',
      );
    }

    const soldOutChapter = remainingChapters.find(
      (chapter) =>
        chapter.edition &&
        chapter.edition.mintedCopies >= chapter.edition.maxCopies,
    );
    if (soldOutChapter) {
      throw new BadRequestException(
        `Chapter ${soldOutChapter.chapterNumber} is sold out.`,
      );
    }

    const coveredBasePrices = paidCovered.map(
      (chapter) => chapter.edition!.priceInUsdcMinor,
    );
    const coveredBaseTotal = coveredBasePrices.reduce(
      (sum, value) => sum + value,
      0,
    );
    const remainingBasePrices = remainingChapters.map(
      (chapter) => chapter.edition!.priceInUsdcMinor,
    );
    const remainingBaseTotal = remainingBasePrices.reduce(
      (sum, value) => sum + value,
      0,
    );

    const shouldApplyOfferPricing =
      selectedOffer != null &&
      (selectedOffer.type === 'CHAPTER_BUNDLE' ||
        selectedOffer.type === 'FULL_BOOK');

    const totalChargeInUsdcMinor = shouldApplyOfferPricing
      ? Math.max(
          1,
          Math.round(
            (selectedOffer.priceInUsdcMinor * remainingBaseTotal) /
              Math.max(coveredBaseTotal, 1),
          ),
        )
      : remainingBaseTotal;

    const allocatedAmounts = shouldApplyOfferPricing
      ? allocateProportionalAmounts(totalChargeInUsdcMinor, remainingBasePrices)
      : remainingBasePrices;

    return {
      book,
      offer: selectedOffer
        ? {
            id: selectedOffer.id,
            type: selectedOffer.type,
            title: selectedOffer.title,
            priceInUsdcMinor: selectedOffer.priceInUsdcMinor,
          }
        : null,
      totalChargeInUsdcMinor,
      items: remainingChapters.map((chapter, index) => ({
        chapterId: chapter.id,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        offerId: selectedOffer?.id ?? chapter.offer!.id,
        editionId: chapter.edition!.id,
        sellerWalletAddress: chapter.edition!.sellerWalletAddress,
        amountInUsdcMinor: allocatedAmounts[index] ?? 0,
        maxCopies: chapter.edition!.maxCopies,
        mintedCopies: chapter.edition!.mintedCopies,
      })),
    };
  }

  private async estimateGasFeeInUsdcMinor(chapterCount: number) {
    const estimatedLamportsPerMint = Number(
      process.env.PURCHASE_GAS_ESTIMATE_LAMPORTS_PER_CHAPTER ?? '1500000',
    );
    const quote =
      await this.priceQuoteService.lamportsToUsdcMinorWithLockedQuote(
        Math.max(0, chapterCount * estimatedLamportsPerMint),
      );

    return quote.feeInUsdcMinor;
  }

  async quotePurchase(userId: string, dto: QuotePurchaseDto) {
    const context = await this.buildPurchaseContext(userId, dto);
    const totalAmountInUsdcMinor = context.items.reduce(
      (sum, item) => sum + item.amountInUsdcMinor,
      0,
    );
    const estimatedGasFeeInUsdcMinor = await this.estimateGasFeeInUsdcMinor(
      context.items.length,
    );

    return {
      offer: context.offer,
      slug: context.book.slug,
      title: context.book.title,
      totalAmountInUsdcMinor,
      estimatedGasFeeInUsdcMinor,
      formattedTotal: formatCurrency(totalAmountInUsdcMinor, 'USDC'),
      formattedEstimatedGasFee: formatCurrency(
        estimatedGasFeeInUsdcMinor,
        'USDC',
      ),
      items: context.items.map((item) => ({
        chapterNumber: item.chapterNumber,
        title: item.title,
        amountInUsdcMinor: item.amountInUsdcMinor,
        formattedPrice: formatCurrency(item.amountInUsdcMinor, 'USDC'),
        remainingCopies: item.maxCopies - item.mintedCopies,
      })),
    };
  }

  async createIntent(userId: string, dto: CreateSolanaPaymentDto) {
    const context = await this.buildPurchaseContext(userId, dto);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const totalAmountInUsdcMinor = context.items.reduce(
      (sum, item) => sum + item.amountInUsdcMinor,
      0,
    );
    const estimatedGasFeeInUsdcMinor = await this.estimateGasFeeInUsdcMinor(
      context.items.length,
    );
    const recipientWalletAddress =
      context.items[0]?.sellerWalletAddress ?? null;

    const order = await this.prisma.order.create({
      data: {
        userId,
        customerEmail: user.email,
        totalAmountInUsdcMinor,
        currency: 'USDC',
        recipientWalletAddress,
        items: {
          create: context.items.map((item) => ({
            offerId: item.offerId,
            chapterId: item.chapterId,
            chapterEditionId: item.editionId,
            amountInUsdcMinor: item.amountInUsdcMinor,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        reference: buildReference(),
        orderId: order.id,
        amountInUsdcMinor: totalAmountInUsdcMinor,
        currency: 'USDC',
        provider: 'LEDGER_USDC',
        providerPayload: {
          stage: 'reserved',
          mode: 'ledger-first',
          estimatedGasFeeInUsdcMinor,
        },
      },
    });

    await this.prisma.purchaseReservation.createMany({
      data: context.items.map((item) => ({
        orderId: order.id,
        chapterEditionId: item.editionId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })),
    });

    return {
      reference: payment.reference,
      status: payment.status,
      network: this.solanaService.getNetwork(),
      totalAmountInUsdcMinor,
      estimatedGasFeeInUsdcMinor,
      formattedAmount: formatCurrency(totalAmountInUsdcMinor, 'USDC'),
      formattedEstimatedGasFee: formatCurrency(
        estimatedGasFeeInUsdcMinor,
        'USDC',
      ),
      itemCount: context.items.length,
    };
  }

  async completeIntent(
    userId: string,
    reference: string,
    dto: CompleteSolanaPaymentDto,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: {
        order: {
          include: {
            user: true,
            items: {
              include: {
                offer: {
                  include: {
                    book: true,
                  },
                },
                chapter: true,
                chapterEdition: true,
              },
            },
            reservations: true,
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

    const firstPurchasedChapterNumber =
      payment.order.items
        .map((item) => item.chapter?.chapterNumber ?? Number.MAX_SAFE_INTEGER)
        .sort((left, right) => left - right)[0] ?? 1;

    if (payment.status === PaymentStatus.SUCCEEDED) {
      const payload =
        payment.providerPayload &&
        typeof payment.providerPayload === 'object' &&
        !Array.isArray(payment.providerPayload)
          ? (payment.providerPayload as Record<string, unknown>)
          : {};
      const gasFeeInUsdcMinor =
        typeof payload.totalGasFeeInUsdcMinor === 'number'
          ? payload.totalGasFeeInUsdcMinor
          : undefined;

      return {
        reference,
        status: 'SUCCEEDED',
        network: this.solanaService.getNetwork(),
        chainTxSignature: payment.chainTxSignature ?? 'N/A',
        formattedAmount: formatCurrency(payment.amountInUsdcMinor, 'USDC'),
        firstPurchasedChapterNumber,
        gasFeeInUsdcMinor,
        formattedGasFee:
          typeof gasFeeInUsdcMinor === 'number'
            ? formatCurrency(gasFeeInUsdcMinor, 'USDC')
            : undefined,
      };
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('This payment is no longer pending.');
    }

    if (
      payment.order.reservations.some(
        (reservation) => reservation.expiresAt < new Date(),
      )
    ) {
      throw new BadRequestException(
        'This reservation expired. Create a new payment intent.',
      );
    }

    const ownershipWallet = await this.booksService.getDefaultWallet(
      userId,
      dto.ownershipWalletId,
    );
    if (this.blockedWalletSet().has(ownershipWallet.address)) {
      throw new BadRequestException(
        'Risk policy blocked this wallet from checkout. Contact support.',
      );
    }
    await this.enforceVelocityAndCaps(userId, payment.amountInUsdcMinor);

    const estimatedGasFeeInUsdcMinor = await this.estimateGasFeeInUsdcMinor(
      payment.order.items.length,
    );

    const mintedAssets: Array<{
      itemId: string;
      chapterEditionId: string;
      chapterNumber: number;
      mintAddress: string;
      tokenAccountAddress: string;
      editionAddress: string;
      editionMetadataAddress: string;
      signature: string;
      confirmationSlot: number | null;
      blockTime: Date | null;
      serialNumber: number;
      feeInLamports: number;
    }> = [];
    let mintFailure: unknown = null;

    try {
      const reservedCopies = await this.prisma.$transaction(async (tx) => {
        const currentPayload =
          payment.providerPayload &&
          typeof payment.providerPayload === 'object' &&
          !Array.isArray(payment.providerPayload)
            ? (payment.providerPayload as Record<string, unknown>)
            : {};
        const lock = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
            OR: [
              {
                providerPayload: {
                  equals: Prisma.AnyNull,
                },
              },
              {
                providerPayload: {
                  path: ['stage'],
                  equals: 'reserved',
                },
              },
            ],
          },
          data: {
            providerPayload: {
              ...currentPayload,
              stage: 'processing',
              processingStartedAt: new Date().toISOString(),
            },
          },
        });

        if (lock.count !== 1) {
          throw new BadRequestException(
            'This payment is already being processed. Refresh purchase history.',
          );
        }

        const buyerWallet = await tx.wallet.upsert({
          where: {
            userId,
          },
          update: {},
          create: {
            userId,
          },
        });

        const requiredAmount =
          payment.amountInUsdcMinor + estimatedGasFeeInUsdcMinor;
        if (buyerWallet.availableBalanceInUsdcMinor < requiredAmount) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_BALANCE',
            message:
              'Insufficient wallet balance for purchase + estimated sponsored gas. Top up and retry.',
            requiredAmountInUsdcMinor: requiredAmount,
            availableAmountInUsdcMinor: buyerWallet.availableBalanceInUsdcMinor,
          });
        }

        await this.ledgerService.postEntry(
          {
            userId,
            idempotencyKey: `purchase:hold:${payment.id}`,
            type: LedgerEntryType.PURCHASE_HOLD,
            amountInUsdcMinor: -payment.amountInUsdcMinor,
            availableDeltaInUsdcMinor: -payment.amountInUsdcMinor,
            pendingDeltaInUsdcMinor: payment.amountInUsdcMinor,
            description: `Funds held for chapter purchase ${payment.reference}`,
            reference: payment.reference,
            mirrorWalletTransactionType: WalletTransactionType.PURCHASE,
          },
          tx,
        );

        const reserved: Array<{
          itemId: string;
          chapterEditionId: string;
          serialNumber: number;
        }> = [];

        for (const item of payment.order.items) {
          if (!item.chapterEdition) {
            throw new BadRequestException(
              'Order item is missing chapter edition metadata.',
            );
          }

          const claimed = await tx.$queryRaw<Array<{ mintedCopies: number }>>`
            UPDATE "ChapterEdition"
            SET "mintedCopies" = "mintedCopies" + 1
            WHERE "id" = ${item.chapterEdition.id}
              AND "mintedCopies" < "maxCopies"
            RETURNING "mintedCopies";
          `;

          if (claimed.length === 0) {
            throw new BadRequestException(
              `Chapter ${item.chapter?.chapterNumber ?? '?'} is sold out.`,
            );
          }

          reserved.push({
            itemId: item.id,
            chapterEditionId: item.chapterEdition.id,
            serialNumber: claimed[0].mintedCopies,
          });
        }

        return reserved;
      });

      const reservedByItemId = new Map(
        reservedCopies.map((entry) => [entry.itemId, entry]),
      );

      const sellerAddresses = Array.from(
        new Set(
          payment.order.items
            .map((item) => item.chapterEdition?.sellerWalletAddress)
            .filter((address): address is string => Boolean(address)),
        ),
      );
      const sellerWallets = sellerAddresses.length
        ? await this.prisma.userChainWallet.findMany({
            where: {
              address: {
                in: sellerAddresses,
              },
              isActive: true,
            },
          })
        : [];
      const sellerWalletByAddress = new Map(
        sellerWallets.map((wallet) => [wallet.address, wallet]),
      );

      for (const item of payment.order.items) {
        try {
          if (!item.chapter || !item.chapterEdition) {
            throw new BadRequestException(
              'Order item is missing chapter metadata.',
            );
          }

          const reservedCopy = reservedByItemId.get(item.id);
          if (!reservedCopy) {
            throw new BadRequestException(
              `Reserved chapter copy not found for Chapter ${item.chapter.chapterNumber}.`,
            );
          }

          const sellerWallet = sellerWalletByAddress.get(
            item.chapterEdition.sellerWalletAddress,
          );
          if (!sellerWallet?.encryptedPrivateKey) {
            throw new BadRequestException(
              'Paid chapter minting requires a custodial seller wallet.',
            );
          }

          const mintedAsset = await this.solanaService.mintChapterAsset({
            masterMintAddress: item.chapterEdition.masterMintAddress,
            destinationWalletAddress: ownershipWallet.address,
            editionNumber: reservedCopy.serialNumber,
            collectionMintAddress: item.chapterEdition.collectionMintAddress,
            masterTokenAccountOwnerEncryptedPrivateKey:
              sellerWallet.encryptedPrivateKey,
          });

          mintedAssets.push({
            itemId: item.id,
            chapterEditionId: item.chapterEdition.id,
            chapterNumber: item.chapter.chapterNumber,
            ...mintedAsset,
            serialNumber: reservedCopy.serialNumber,
          });
        } catch (error) {
          mintFailure = error;
          break;
        }
      }

      const totalGasLamports = mintedAssets.reduce(
        (sum, asset) => sum + asset.feeInLamports,
        0,
      );
      const gasQuote =
        await this.priceQuoteService.lamportsToUsdcMinorWithLockedQuote(
          totalGasLamports,
        );

      const mintedByItemId = new Set(mintedAssets.map((asset) => asset.itemId));
      const mintedItems = payment.order.items.filter((item) =>
        mintedByItemId.has(item.id),
      );
      const unmintedItems = payment.order.items.filter(
        (item) => !mintedByItemId.has(item.id),
      );
      const mintedAmountInUsdcMinor = mintedItems.reduce(
        (sum, item) => sum + item.amountInUsdcMinor,
        0,
      );
      const releasedAmountInUsdcMinor =
        payment.amountInUsdcMinor - mintedAmountInUsdcMinor;
      const isPartial = mintFailure !== null && mintedItems.length > 0;
      const isTotalFailure = mintedItems.length === 0;
      const failedChapterTitles = unmintedItems
        .map((item) =>
          item.chapter
            ? `Chapter ${item.chapter.chapterNumber}: ${item.chapter.title}`
            : null,
        )
        .filter((item): item is string => Boolean(item));

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: isTotalFailure
              ? PaymentStatus.FAILED
              : PaymentStatus.SUCCEEDED,
            paidAt: isTotalFailure ? null : new Date(),
            payerWalletAddress: ownershipWallet.address,
            recipientWalletAddress: payment.order.recipientWalletAddress,
            chainTxSignature: mintedAssets[0]?.signature,
            confirmationSlot: mintedAssets[0]?.confirmationSlot ?? undefined,
            providerPayload: {
              stage: isTotalFailure ? 'failed' : 'completed',
              network: this.solanaService.getNetwork(),
              payerMode: ownershipWallet.custodyType,
              settlementMode: 'ledger-first',
              totalGasFeeInUsdcMinor: gasQuote.feeInUsdcMinor,
              totalGasLamports,
              solUsdPriceLocked: gasQuote.solUsdPrice,
              partialFulfillment: isPartial,
              mintedChapters: mintedAssets.map((asset) => asset.chapterNumber),
              failedChapters: unmintedItems
                .map((item) => item.chapter?.chapterNumber)
                .filter((chapterNumber): chapterNumber is number =>
                  Boolean(chapterNumber),
                ),
              failureReason:
                mintFailure instanceof Error ? mintFailure.message : undefined,
            },
          },
        });

        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            status: isTotalFailure
              ? OrderStatus.CANCELLED
              : OrderStatus.COMPLETED,
            payerWalletAddress: ownershipWallet.address,
            recipientWalletAddress: payment.order.recipientWalletAddress,
          },
        });

        if (mintedAmountInUsdcMinor > 0) {
          await this.ledgerService.postEntry(
            {
              userId,
              idempotencyKey: `purchase:debit:${payment.id}`,
              type: LedgerEntryType.PURCHASE_DEBIT,
              amountInUsdcMinor: -mintedAmountInUsdcMinor,
              availableDeltaInUsdcMinor: 0,
              pendingDeltaInUsdcMinor: -mintedAmountInUsdcMinor,
              description: `Chapter purchase debited ${payment.reference}`,
              reference: payment.reference,
              mirrorWalletTransactionType: WalletTransactionType.PURCHASE,
            },
            tx,
          );
        }

        if (releasedAmountInUsdcMinor > 0) {
          await this.ledgerService.postEntry(
            {
              userId,
              idempotencyKey: `purchase:release:${payment.id}`,
              type: LedgerEntryType.PURCHASE_RELEASE,
              amountInUsdcMinor: releasedAmountInUsdcMinor,
              availableDeltaInUsdcMinor: releasedAmountInUsdcMinor,
              pendingDeltaInUsdcMinor: -releasedAmountInUsdcMinor,
              description: `Purchase hold released ${payment.reference}`,
              reference: payment.reference,
              mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
            },
            tx,
          );
        }

        if (mintedAmountInUsdcMinor > 0) {
          await this.ledgerService.postEntry(
            {
              userId,
              idempotencyKey: `gas:purchase:${payment.id}`,
              type: LedgerEntryType.GAS_FEE_DEBIT,
              amountInUsdcMinor: -gasQuote.feeInUsdcMinor,
              availableDeltaInUsdcMinor: -gasQuote.feeInUsdcMinor,
              description: `Sponsored gas fee for ${payment.reference}`,
              reference: payment.reference,
              metadataJson: {
                totalGasLamports,
                solUsdPriceLocked: gasQuote.solUsdPrice,
              },
              mirrorWalletTransactionType: WalletTransactionType.GAS_FEE,
            },
            tx,
          );
        }

        for (const item of mintedItems) {
          if (!item.chapter || !item.chapterEdition) {
            throw new BadRequestException(
              'Order item is missing chapter metadata.',
            );
          }

          const mintedAsset = mintedAssets.find(
            (asset) => asset.itemId === item.id,
          );

          if (!mintedAsset) {
            throw new BadRequestException('Missing confirmed mint result.');
          }

          await tx.chapterEdition.update({
            where: {
              id: item.chapterEdition.id,
            },
            data: {
              mintedCopies: {
                increment: 1,
              },
            },
          });

          await tx.chapterToken.create({
            data: {
              chapterId: item.chapter.id,
              editionId: item.chapterEdition.id,
              ownerUserId: userId,
              ownerWalletId: ownershipWallet.id,
              ownerWalletAddress: ownershipWallet.address,
              mintAddress: mintedAsset.mintAddress,
              tokenAccountAddress: mintedAsset.tokenAccountAddress,
              editionAddress: mintedAsset.editionAddress,
              editionMetadataAddress: mintedAsset.editionMetadataAddress,
              serialNumber: mintedAsset.serialNumber,
              mintTxSignature: mintedAsset.signature,
              currentOwnershipVerifiedAt: new Date(),
            },
          });

          await tx.onchainTransaction.create({
            data: {
              signature: mintedAsset.signature,
              network: this.solanaService.getNetwork(),
              txType: OnchainTransactionType.PRINT_EDITION_MINT,
              status: OnchainTransactionStatus.CONFIRMED,
              slot: mintedAsset.confirmationSlot ?? undefined,
              blockTime: mintedAsset.blockTime ?? undefined,
              confirmationCommitment:
                this.solanaService.getConfirmationCommitment(),
              metadataJson: {
                mintAddress: mintedAsset.mintAddress,
                tokenAccountAddress: mintedAsset.tokenAccountAddress,
                editionAddress: mintedAsset.editionAddress,
                editionMetadataAddress: mintedAsset.editionMetadataAddress,
                serialNumber: mintedAsset.serialNumber,
                collectionMintAddress:
                  item.chapterEdition.collectionMintAddress,
                feeInLamports: mintedAsset.feeInLamports,
              },
              userId,
              bookId: item.offer.bookId,
              chapterId: item.chapter.id,
              orderId: payment.orderId,
              paymentId: payment.id,
            },
          });

          await this.ledgerService.postEntry(
            {
              userId: item.offer.book.authorId,
              idempotencyKey: `sale:${payment.id}:${item.id}`,
              type: LedgerEntryType.SALE_CREDIT,
              amountInUsdcMinor: item.amountInUsdcMinor,
              availableDeltaInUsdcMinor: item.amountInUsdcMinor,
              description: `Chapter sale credit for ${item.offer.title}`,
              reference: payment.reference,
              mirrorWalletTransactionType: WalletTransactionType.SALE,
            },
            tx,
          );

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
              revenueInUsdcMinor: {
                increment: item.amountInUsdcMinor,
              },
            },
            create: {
              bookId: item.offer.bookId,
              date: new Date(new Date().toDateString()),
              purchases: 1,
              revenueInUsdcMinor: item.amountInUsdcMinor,
            },
          });
        }

        for (const item of unmintedItems) {
          if (!item.chapterEdition) {
            continue;
          }

          await tx.chapterEdition.update({
            where: { id: item.chapterEdition.id },
            data: {
              mintedCopies: {
                decrement: 1,
              },
            },
          });
        }

        if (mintedItems.length > 0) {
          await tx.purchaseReservation.updateMany({
            where: {
              orderId: payment.orderId,
              chapterEditionId: {
                in: mintedItems
                  .map((item) => item.chapterEdition?.id)
                  .filter((id): id is string => Boolean(id)),
              },
              releasedAt: null,
            },
            data: {
              fulfilledAt: new Date(),
              releasedAt: new Date(),
            },
          });
        }

        if (unmintedItems.length > 0) {
          await tx.purchaseReservation.updateMany({
            where: {
              orderId: payment.orderId,
              chapterEditionId: {
                in: unmintedItems
                  .map((item) => item.chapterEdition?.id)
                  .filter((id): id is string => Boolean(id)),
              },
              releasedAt: null,
            },
            data: {
              releasedAt: new Date(),
            },
          });
        }
      });

      if (mintedItems.length > 0) {
        const network = this.solanaService.getNetwork();
        const explorerCluster =
          network && network !== 'mainnet-beta'
            ? `?cluster=${encodeURIComponent(network)}`
            : '';
        const mintedAssetLinks = mintedItems
          .map((item) => {
            const mintedAsset = mintedAssets.find(
              (asset) => asset.itemId === item.id,
            );
            const chapterNumber = item.chapter?.chapterNumber;
            if (!mintedAsset?.mintAddress) {
              return null;
            }

            const label = chapterNumber
              ? `View Chapter ${chapterNumber} asset`
              : 'View chapter asset';

            return {
              label,
              url: `https://explorer.solana.com/address/${mintedAsset.mintAddress}${explorerCluster}`,
            };
          })
          .filter(
            (
              item,
            ): item is {
              label: string;
              url: string;
            } => Boolean(item),
          );

        await this.emailsService.sendPurchaseSuccessEmail({
          to: payment.order.user.email,
          displayName: payment.order.user.displayName,
          bookTitle: payment.order.items[0]?.offer.book.title ?? 'your book',
          chapterTitles: mintedItems
            .map((item) =>
              item.chapter
                ? `Chapter ${item.chapter.chapterNumber}: ${item.chapter.title}`
                : null,
            )
            .filter((item): item is string => Boolean(item)),
          failedChapterTitles: failedChapterTitles.length
            ? failedChapterTitles
            : undefined,
          amountFormatted: formatCurrency(mintedAmountInUsdcMinor, 'USDC'),
          reference,
          assetLinks: mintedAssetLinks.length ? mintedAssetLinks : undefined,
        });
      }

      if (isTotalFailure) {
        await this.emailsService.sendPurchaseFailedEmail({
          to: payment.order.user.email,
          displayName: payment.order.user.displayName,
          bookTitle: payment.order.items[0]?.offer.book.title ?? 'your book',
          chapterTitles: payment.order.items
            .map((item) =>
              item.chapter
                ? `Chapter ${item.chapter.chapterNumber}: ${item.chapter.title}`
                : null,
            )
            .filter((item): item is string => Boolean(item)),
          amountFormatted: formatCurrency(payment.amountInUsdcMinor, 'USDC'),
          reference,
          failureReason:
            mintFailure instanceof Error ? mintFailure.message : undefined,
        });
        throw new InternalServerErrorException(
          'Minting failed before purchase completion. Funds were released back to your wallet.',
        );
      }

      const purchasedChapterNumbers = mintedItems
        .map((item) => item.chapter?.chapterNumber)
        .filter((chapterNumber): chapterNumber is number =>
          Boolean(chapterNumber),
        )
        .sort((left, right) => left - right);

      return {
        reference,
        status: 'SUCCEEDED',
        network: this.solanaService.getNetwork(),
        chainTxSignature: mintedAssets[0]?.signature ?? 'N/A',
        formattedAmount: formatCurrency(mintedAmountInUsdcMinor, 'USDC'),
        firstPurchasedChapterNumber:
          purchasedChapterNumbers[0] ?? firstPurchasedChapterNumber,
        gasFeeInUsdcMinor: gasQuote.feeInUsdcMinor,
        formattedGasFee: formatCurrency(gasQuote.feeInUsdcMinor, 'USDC'),
        partialFulfillment: isPartial,
        failedChapterNumbers: isPartial
          ? unmintedItems
              .map((item) => item.chapter?.chapterNumber)
              .filter((chapterNumber): chapterNumber is number =>
                Boolean(chapterNumber),
              )
              .sort((left, right) => left - right)
          : [],
      };
    } catch (error) {
      // Best-effort: if we placed a hold but failed before settling the purchase,
      // release held funds and mark the payment/order as failed.
      // Note: If minting succeeded on-chain but settlement failed, we do NOT
      // auto-release here; those cases should be reconciled.
      if (mintedAssets.length === 0) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        await this.prisma.$transaction(async (tx) => {
          const hold = await tx.ledgerJournal.findUnique({
            where: { idempotencyKey: `purchase:hold:${payment.id}` },
          });

          if (hold) {
            await this.ledgerService.postEntry(
              {
                userId,
                idempotencyKey: `purchase:release:${payment.id}`,
                type: LedgerEntryType.PURCHASE_RELEASE,
                amountInUsdcMinor: payment.amountInUsdcMinor,
                availableDeltaInUsdcMinor: payment.amountInUsdcMinor,
                pendingDeltaInUsdcMinor: -payment.amountInUsdcMinor,
                description: `Purchase hold released ${payment.reference}`,
                reference: payment.reference,
                mirrorWalletTransactionType: WalletTransactionType.ADJUSTMENT,
                metadataJson: { failureReason: message },
              },
              tx,
            );
          }

          const currentPayload =
            payment.providerPayload &&
            typeof payment.providerPayload === 'object' &&
            !Array.isArray(payment.providerPayload)
              ? (payment.providerPayload as Record<string, unknown>)
              : {};
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              paidAt: null,
              providerPayload: {
                ...currentPayload,
                stage: 'failed',
                network: this.solanaService.getNetwork(),
                settlementMode: 'ledger-first',
                failureReason: message,
              },
            },
          });

          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.CANCELLED },
          });

          await tx.purchaseReservation.updateMany({
            where: { orderId: payment.orderId, releasedAt: null },
            data: { releasedAt: new Date() },
          });
        });
      }

      throw error;
    }
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
            chapter: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
