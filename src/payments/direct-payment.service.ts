import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { formatCurrency } from '../common/utils/currency';
import { EmailsService } from '../emails/emails.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceQuoteService } from '../chain/price-quote.service';
import { SolanaService } from '../chain/solana.service';
import { CompleteSolanaPaymentDto } from './dto/payment.dto';

@Injectable()
export class DirectPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaService: SolanaService,
    private readonly priceQuoteService: PriceQuoteService,
    private readonly ledgerService: LedgerService,
    private readonly emailsService: EmailsService,
  ) {}

  async completeDirectTransfer(
    userId: string,
    reference: string,
    dto: CompleteSolanaPaymentDto,
  ) {
    const payerWalletAddress =
      dto.ownershipWalletAddress?.trim() ?? dto.ownershipWalletId?.trim();
    const chainTxSignature = dto.chainTxSignature?.trim();

    if (!payerWalletAddress || !chainTxSignature) {
      return null;
    }

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
        chainTxSignature: payment.chainTxSignature ?? chainTxSignature,
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

    if (this.solanaService.isValidAddress(payerWalletAddress) === false) {
      throw new BadRequestException(
        'A valid Solana wallet address is required to complete this payment.',
      );
    }

    const recipientWalletAddress =
      payment.order.recipientWalletAddress ??
      (payment.providerPayload &&
      typeof payment.providerPayload === 'object' &&
      !Array.isArray(payment.providerPayload)
        ? (payment.providerPayload as Record<string, unknown>)
            .recipientWalletAddress
        : null);
    if (!recipientWalletAddress || typeof recipientWalletAddress !== 'string') {
      throw new BadRequestException(
        'This payment is missing a settlement wallet address.',
      );
    }

    const payload =
      payment.providerPayload &&
      typeof payment.providerPayload === 'object' &&
      !Array.isArray(payment.providerPayload)
        ? (payment.providerPayload as Record<string, unknown>)
        : {};
    const platformTreasuryWalletAddress =
      typeof payload.platformTreasuryWalletAddress === 'string'
        ? payload.platformTreasuryWalletAddress
        : null;
    const sellerNetAmountInUsdcMinor =
      typeof payload.sellerNetAmountInUsdcMinor === 'number'
        ? payload.sellerNetAmountInUsdcMinor
        : payment.amountInUsdcMinor;
    const platformFeeInUsdcMinor =
      typeof payload.platformFeeInUsdcMinor === 'number'
        ? payload.platformFeeInUsdcMinor
        : 0;
    const platformFeeBps =
      typeof payload.platformFeeBps === 'number' ? payload.platformFeeBps : 0;

    const blockedWallets = new Set(
      (process.env.RISK_BLOCKED_WALLET_ADDRESSES ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (blockedWallets.has(payerWalletAddress)) {
      throw new BadRequestException(
        'Risk policy blocked this wallet from checkout. Contact support.',
      );
    }

    if (!platformTreasuryWalletAddress) {
      throw new BadRequestException(
        'This payment is missing a platform treasury address.',
      );
    }

    const transfer =
      await this.solanaService.verifyUsdcTransferSignatureWithRecipients({
      signature: chainTxSignature,
      sourceOwnerAddress: payerWalletAddress,
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

    const grossPurchaseAmountInUsdcMinor =
      sellerNetAmountInUsdcMinor + platformFeeInUsdcMinor;
    if (grossPurchaseAmountInUsdcMinor !== payment.amountInUsdcMinor) {
      throw new BadRequestException(
        'Purchase split does not match the payment amount.',
      );
    }

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
        const lock = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
            OR: [
              {
                providerPayload: {
                  equals: Prisma.JsonNull,
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
              ...(payment.providerPayload &&
              typeof payment.providerPayload === 'object' &&
              !Array.isArray(payment.providerPayload)
                ? (payment.providerPayload as Record<string, unknown>)
                : {}),
              stage: 'processing',
              chainTxSignature,
              processingStartedAt: new Date().toISOString(),
            },
          },
        });

        if (lock.count !== 1) {
          throw new BadRequestException(
            'This payment is already being processed. Refresh purchase history.',
          );
        }

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

          const mintedAsset = await this.solanaService.mintChapterAsset({
            masterMintAddress: item.chapterEdition.masterMintAddress,
            destinationWalletAddress: payerWalletAddress,
            editionNumber: reservedCopy.serialNumber,
            collectionMintAddress: item.chapterEdition.collectionMintAddress,
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
          payerWalletAddress,
          recipientWalletAddress,
          chainTxSignature: transfer.signature,
          confirmationSlot: transfer.confirmationSlot ?? undefined,
          providerPayload: {
              ...(payment.providerPayload &&
              typeof payment.providerPayload === 'object' &&
              !Array.isArray(payment.providerPayload)
                ? (payment.providerPayload as Record<string, unknown>)
                : {}),
              stage: isTotalFailure ? 'failed' : 'completed',
              network: this.solanaService.getNetwork(),
              settlementMode: 'direct-transfer',
              transferSignature: transfer.signature,
              platformFeeBps,
              platformFeeInUsdcMinor,
              sellerNetAmountInUsdcMinor,
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
            payerWalletAddress,
            recipientWalletAddress,
          },
        });

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
              ownerWalletAddress: payerWalletAddress,
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
              amountInUsdcMinor: Math.floor(
                (item.amountInUsdcMinor * (10_000 - platformFeeBps)) /
                  10_000,
              ),
              availableDeltaInUsdcMinor: Math.floor(
                (item.amountInUsdcMinor * (10_000 - platformFeeBps)) /
                  10_000,
              ),
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
                increment: Math.floor(
                  (item.amountInUsdcMinor * (10_000 - platformFeeBps)) /
                    10_000,
                ),
              },
            },
            create: {
              bookId: item.offer.bookId,
              date: new Date(new Date().toDateString()),
              purchases: 1,
              revenueInUsdcMinor: Math.floor(
                (item.amountInUsdcMinor * (10_000 - platformFeeBps)) /
                  10_000,
              ),
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
          'Minting failed before purchase completion.',
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
        chainTxSignature: mintedAssets[0]?.signature ?? transfer.signature,
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.$transaction(async (tx) => {
        const currentPayload =
          payment.providerPayload &&
          typeof payment.providerPayload === 'object' &&
          !Array.isArray(payment.providerPayload)
            ? (payment.providerPayload as Record<string, unknown>)
            : {};
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status:
              mintedAssets.length > 0
                ? PaymentStatus.SUCCEEDED
                : PaymentStatus.FAILED,
            paidAt: mintedAssets.length > 0 ? new Date() : null,
            providerPayload: {
              ...currentPayload,
              stage: mintedAssets.length > 0 ? 'partial' : 'failed',
              network: this.solanaService.getNetwork(),
              settlementMode: 'direct-transfer',
              failureReason: message,
            },
          },
        });

        if (mintedAssets.length === 0) {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.CANCELLED },
          });

          await tx.purchaseReservation.updateMany({
            where: { orderId: payment.orderId, releasedAt: null },
            data: { releasedAt: new Date() },
          });
        }
      });

      if (mintedAssets.length === 0) {
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
          failureReason: message,
        });
        throw new InternalServerErrorException(
          'Minting failed before purchase completion.',
        );
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
