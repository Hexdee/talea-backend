import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OnchainTransactionStatus,
  OnchainTransactionType,
  PaymentStatus,
  WalletTransactionType,
} from '@prisma/client';
import { BooksService } from '../books/books.service';
import { formatCurrency } from '../common/utils/currency';
import { SolanaService } from '../chain/solana.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompleteSolanaPaymentDto,
  CreateSolanaPaymentDto,
  QuotePurchaseDto,
} from './dto/payment.dto';

function buildReference() {
  return `TAL-SOL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booksService: BooksService,
    private readonly solanaService: SolanaService,
  ) {}

  private async buildPurchaseContext(userId: string, dto: QuotePurchaseDto) {
    const book = await this.prisma.book.findUnique({
      where: {
        slug: dto.slug,
      },
      include: {
        author: true,
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
    const selectedChapterNumbers = Array.from(new Set(dto.chapterNumbers)).sort(
      (left, right) => left - right,
    );

    const selectedChapters = selectedChapterNumbers
      .map((chapterNumber) =>
        book.chapters.find(
          (chapter) => chapter.chapterNumber === chapterNumber,
        ),
      )
      .filter((chapter): chapter is NonNullable<typeof chapter> =>
        Boolean(chapter),
      );

    if (selectedChapters.length !== selectedChapterNumbers.length) {
      throw new BadRequestException(
        'One or more selected chapters do not exist.',
      );
    }

    const purchasableChapters = selectedChapters.filter(
      (chapter) => !chapter.isFree,
    );

    if (purchasableChapters.length === 0) {
      throw new BadRequestException(
        'Only paid chapters require onchain purchase.',
      );
    }

    const unavailableChapter = purchasableChapters.find(
      (chapter) => !chapter.edition || !chapter.offer,
    );
    if (unavailableChapter) {
      throw new BadRequestException(
        `Chapter ${unavailableChapter.chapterNumber} is not published for sale yet.`,
      );
    }

    const alreadyOwnedChapter = purchasableChapters.find((chapter) =>
      ownedChapterIds.has(chapter.id),
    );
    if (alreadyOwnedChapter) {
      throw new BadRequestException(
        `You already own Chapter ${alreadyOwnedChapter.chapterNumber}.`,
      );
    }

    const soldOutChapter = purchasableChapters.find(
      (chapter) =>
        chapter.edition &&
        chapter.edition.mintedCopies >= chapter.edition.maxCopies,
    );
    if (soldOutChapter) {
      throw new BadRequestException(
        `Chapter ${soldOutChapter.chapterNumber} is sold out.`,
      );
    }

    return {
      book,
      items: purchasableChapters.map((chapter) => ({
        chapterId: chapter.id,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        offerId: chapter.offer!.id,
        editionId: chapter.edition!.id,
        sellerWalletAddress: chapter.edition!.sellerWalletAddress,
        amountInUsdcMinor: chapter.edition!.priceInUsdcMinor,
        maxCopies: chapter.edition!.maxCopies,
        mintedCopies: chapter.edition!.mintedCopies,
      })),
    };
  }

  async quotePurchase(userId: string, dto: QuotePurchaseDto) {
    const context = await this.buildPurchaseContext(userId, dto);
    const totalAmountInUsdcMinor = context.items.reduce(
      (sum, item) => sum + item.amountInUsdcMinor,
      0,
    );

    return {
      slug: context.book.slug,
      title: context.book.title,
      totalAmountInUsdcMinor,
      formattedTotal: formatCurrency(totalAmountInUsdcMinor, 'USDC'),
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
        provider: 'SOLANA_USDC',
        providerPayload: {
          stage: 'reserved',
          mode: 'custodial-devnet-usdc',
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
      formattedAmount: formatCurrency(totalAmountInUsdcMinor, 'USDC'),
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
            items: {
              include: {
                offer: true,
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

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        'Only pending Solana payments can be completed.',
      );
    }

    if (
      payment.order.reservations.some(
        (reservation) => reservation.expiresAt < new Date(),
      )
    ) {
      throw new BadRequestException(
        'This reservation expired. Create a new Solana payment intent.',
      );
    }

    const ownershipWallet = await this.booksService.getDefaultWallet(
      userId,
      dto.ownershipWalletId,
    );

    if (ownershipWallet.custodyType !== 'CUSTODIAL') {
      throw new BadRequestException(
        'Checkout is custodial-only for v1. Select your Lesenpad custodial wallet.',
      );
    }

    if (!ownershipWallet.encryptedPrivateKey) {
      throw new BadRequestException(
        'The selected custodial wallet cannot sign payments.',
      );
    }

    const paymentTransfer =
      await this.solanaService.transferUsdcFromCustodialToTreasury({
        encryptedPrivateKey: ownershipWallet.encryptedPrivateKey,
        amountInUsdcMinor: payment.amountInUsdcMinor,
      });

    const mintedAssets: Array<{
      itemId: string;
      mintAddress: string;
      tokenAccountAddress: string;
      editionAddress: string;
      editionMetadataAddress: string;
      signature: string;
      confirmationSlot: number | null;
      blockTime: Date | null;
      serialNumber: number;
    }> = [];

    for (const item of payment.order.items) {
      if (!item.chapter || !item.chapterEdition) {
        throw new BadRequestException(
          'Order item is missing chapter metadata.',
        );
      }

      const latestEdition = await this.prisma.chapterEdition.findUniqueOrThrow({
        where: {
          id: item.chapterEdition.id,
        },
      });

      if (latestEdition.mintedCopies >= latestEdition.maxCopies) {
        throw new BadRequestException(
          `Chapter ${item.chapter.chapterNumber} sold out before minting.`,
        );
      }

      const serialNumber = latestEdition.mintedCopies + 1;
      const mintedAsset = await this.solanaService.mintChapterAsset({
        masterMintAddress: latestEdition.masterMintAddress,
        destinationWalletAddress: ownershipWallet.address,
        editionNumber: serialNumber,
        collectionMintAddress: latestEdition.collectionMintAddress,
      });

      mintedAssets.push({
        itemId: item.id,
        ...mintedAsset,
        serialNumber,
      });
    }

    const firstPurchasedChapterNumber =
      payment.order.items
        .map((item) => item.chapter?.chapterNumber ?? Number.MAX_SAFE_INTEGER)
        .sort((left, right) => left - right)[0] ?? 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          payerWalletAddress: ownershipWallet.address,
          recipientWalletAddress: payment.order.recipientWalletAddress,
          buyerTokenAccountAddress: paymentTransfer.sourceTokenAccountAddress,
          treasuryTokenAccountAddress:
            paymentTransfer.destinationTokenAccountAddress,
          chainTxSignature: paymentTransfer.signature,
          confirmationSlot: paymentTransfer.confirmationSlot,
          providerPayload: {
            stage: 'completed',
            network: this.solanaService.getNetwork(),
            payerMode: ownershipWallet.custodyType,
            treasuryTokenAccountAddress:
              paymentTransfer.destinationTokenAccountAddress,
          },
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: 'COMPLETED',
          payerWalletAddress: ownershipWallet.address,
          recipientWalletAddress: payment.order.recipientWalletAddress,
        },
      });

      await tx.onchainTransaction.create({
        data: {
          signature: paymentTransfer.signature,
          network: this.solanaService.getNetwork(),
          txType: OnchainTransactionType.USDC_TRANSFER,
          status: OnchainTransactionStatus.CONFIRMED,
          slot: paymentTransfer.confirmationSlot ?? undefined,
          blockTime: paymentTransfer.blockTime ?? undefined,
          confirmationCommitment:
            this.solanaService.getConfirmationCommitment(),
          metadataJson: {
            purpose: 'chapter_purchase_payment',
            sourceTokenAccountAddress:
              paymentTransfer.sourceTokenAccountAddress,
            destinationTokenAccountAddress:
              paymentTransfer.destinationTokenAccountAddress,
          },
          userId,
          orderId: payment.orderId,
          paymentId: payment.id,
        },
      });

      for (const item of payment.order.items) {
        if (!item.chapter || !item.chapterEdition) {
          throw new BadRequestException(
            'Order item is missing chapter metadata.',
          );
        }

        if (item.chapterEdition.mintedCopies >= item.chapterEdition.maxCopies) {
          throw new BadRequestException(
            `Chapter ${item.chapter.chapterNumber} sold out before minting.`,
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
              collectionMintAddress: item.chapterEdition.collectionMintAddress,
            },
            userId,
            bookId: item.offer.bookId,
            chapterId: item.chapter.id,
            orderId: payment.orderId,
            paymentId: payment.id,
          },
        });

        const book = await tx.book.findUniqueOrThrow({
          where: {
            id: item.offer.bookId,
          },
        });

        const wallet = await tx.wallet.upsert({
          where: {
            userId: book.authorId,
          },
          update: {
            availableBalanceInUsdcMinor: {
              increment: item.amountInUsdcMinor,
            },
          },
          create: {
            userId: book.authorId,
            availableBalanceInUsdcMinor: item.amountInUsdcMinor,
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.SALE,
            amountInUsdcMinor: item.amountInUsdcMinor,
            reference: payment.reference,
            description: `Onchain chapter sale for ${book.title} · ${item.offer.title}`,
          },
        });

        await tx.libraryItem.upsert({
          where: {
            userId_bookId: {
              userId,
              bookId: book.id,
            },
          },
          update: {},
          create: {
            userId,
            bookId: book.id,
          },
        });

        await tx.analyticsSnapshot.upsert({
          where: {
            bookId_date: {
              bookId: book.id,
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
            bookId: book.id,
            date: new Date(new Date().toDateString()),
            purchases: 1,
            revenueInUsdcMinor: item.amountInUsdcMinor,
          },
        });
      }

      await tx.purchaseReservation.updateMany({
        where: {
          orderId: payment.orderId,
          releasedAt: null,
        },
        data: {
          fulfilledAt: new Date(),
          releasedAt: new Date(),
        },
      });
    });

    return {
      reference,
      status: 'SUCCEEDED',
      network: this.solanaService.getNetwork(),
      chainTxSignature: paymentTransfer.signature,
      formattedAmount: formatCurrency(payment.amountInUsdcMinor, 'USDC'),
      firstPurchasedChapterNumber,
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
