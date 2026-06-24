import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LedgerEntryType } from '@prisma/client';
import { BooksService } from '../books/books.service';
import { PriceQuoteService } from '../chain/price-quote.service';
import { SolanaService } from '../chain/solana.service';
import { formatCurrency } from '../common/utils/currency';
import { EmailsService } from '../emails/emails.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { WithdrawalPolicyService } from '../withdrawal-policy/withdrawal-policy.service';
import {
  CompleteSolanaPaymentDto,
  CreateSolanaPaymentDto,
  QuotePurchaseDto,
} from './dto/payment.dto';
import { DirectPaymentService } from './direct-payment.service';

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
    private readonly directPaymentService: DirectPaymentService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
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
      select: { email: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const sourceOwnerAddress =
      dto.ownershipWalletAddress?.trim() ?? dto.ownershipWalletId?.trim();
    if (!sourceOwnerAddress) {
      throw new BadRequestException(
        'A connected wallet address is required to create this payment intent.',
      );
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

    if (!recipientWalletAddress) {
      throw new BadRequestException(
        'This purchase is missing a settlement wallet address.',
      );
    }

    const platformFeeBps =
      await this.withdrawalPolicyService.getPlatformFeeBps();
    const platformFeeInUsdcMinor = Math.floor(
      (totalAmountInUsdcMinor * platformFeeBps) / 10_000,
    );
    const sellerNetAmountInUsdcMinor =
      totalAmountInUsdcMinor - platformFeeInUsdcMinor;
    const platformTreasuryWalletAddress =
      await this.solanaService.getTreasuryAddress();
    const sponsoredTransfer =
      await this.solanaService.buildSponsoredUsdcTransferTransaction({
        sourceOwnerAddress,
        recipientTransfers: [
          {
            destinationOwnerAddress: recipientWalletAddress,
            amountInUsdcMinor: sellerNetAmountInUsdcMinor,
          },
          {
            destinationOwnerAddress: platformTreasuryWalletAddress,
            amountInUsdcMinor: platformFeeInUsdcMinor,
          },
        ],
      });

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
        provider: 'DIRECT_USDC_TRANSFER',
        providerPayload: {
          stage: 'reserved',
          mode: 'user-signed-sponsored-transfer',
          estimatedGasFeeInUsdcMinor,
          recipientWalletAddress,
          platformTreasuryWalletAddress,
          platformFeeBps,
          platformFeeInUsdcMinor,
          sellerNetAmountInUsdcMinor,
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
      recipientWalletAddress,
      platformTreasuryWalletAddress,
      platformFeeBps,
      platformFeeInUsdcMinor,
      sellerNetAmountInUsdcMinor,
      sponsoredTransferBase64: sponsoredTransfer.transactionBase64,
      sponsoredTransferFeePayerAddress: sponsoredTransfer.feePayerAddress,
      sponsoredTransferRecentBlockhash: sponsoredTransfer.recentBlockhash,
      sponsoredTransferLastValidBlockHeight:
        sponsoredTransfer.lastValidBlockHeight,
      usdcMintAddress: this.solanaService.getUsdcMintAddress(),
      formattedAmount: formatCurrency(totalAmountInUsdcMinor, 'USDC'),
      formattedEstimatedGasFee: formatCurrency(
        estimatedGasFeeInUsdcMinor,
        'USDC',
      ),
      formattedPlatformFee: formatCurrency(platformFeeInUsdcMinor, 'USDC'),
      itemCount: context.items.length,
    };
  }

  async completeIntent(
    userId: string,
    reference: string,
    dto: CompleteSolanaPaymentDto,
  ) {
    const directResult = await this.directPaymentService.completeDirectTransfer(
      userId,
      reference,
      dto,
    );

    if (directResult) {
      return directResult;
    }

    throw new BadRequestException(
      'Non-custodial purchase completion requires direct transfer signing.',
    );

    throw new BadRequestException(
      'Non-custodial purchase completion requires direct transfer signing.',
    );
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
