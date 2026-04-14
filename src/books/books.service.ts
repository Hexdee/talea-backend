import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookStatus, OfferType, SourceFormat } from '@prisma/client';
import type { SessionUser } from '../common/types/authenticated-request';
import { renderPublishedHtml } from '../common/utils/content';
import { formatCurrency } from '../common/utils/currency';
import {
  computeReadMetrics,
  computeReadMetricsFromHtml,
} from '../common/utils/read-time';
import { IpfsService } from '../chain/ipfs.service';
import { SolanaService } from '../chain/solana.service';
import { VaultService } from '../chain/vault.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublishChapterDto,
  ReaderChapterDto,
  ReorderChaptersDto,
  type UpsertBookDto,
  type UpsertChapterDto,
  type UpsertOfferDto,
  type UpsertProgressDto,
} from './dto/book.dto';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

function normalizeChecklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is ChecklistItem =>
        Boolean(item) &&
        typeof item === 'object' &&
        'id' in item &&
        'label' in item &&
        'done' in item,
    )
    .map((item) => ({
      id: String(item.id),
      label: String(item.label).trim(),
      done: Boolean(item.done),
    }))
    .filter((item) => item.label.length > 0)
    .slice(0, 12);
}

function getEncryptedPackagePayload(value: string, fallback: string): string {
  const parsed = JSON.parse(value) as unknown;

  if (
    parsed &&
    typeof parsed === 'object' &&
    'payload' in parsed &&
    typeof parsed.payload === 'string'
  ) {
    return parsed.payload;
  }

  return fallback;
}

function buildReadMetricsData(format: SourceFormat, content: string) {
  const metrics = computeReadMetrics(format, content);

  return {
    wordCount: metrics.wordCount,
    estimatedReadMinutes: metrics.estimatedReadMinutes,
  };
}

@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vaultService: VaultService,
    private readonly ipfsService: IpfsService,
    private readonly solanaService: SolanaService,
  ) {}

  private async ensureUniqueChapterNumber(
    bookId: string,
    chapterNumber: number,
    excludeChapterId?: string,
  ) {
    const existingChapter = await this.prisma.chapter.findFirst({
      where: {
        bookId,
        chapterNumber,
        ...(excludeChapterId
          ? {
              id: {
                not: excludeChapterId,
              },
            }
          : {}),
      },
    });

    if (existingChapter) {
      throw new BadRequestException(
        'Another chapter already uses this chapter number.',
      );
    }
  }

  private async ensureBookOwner(userId: string, bookId: string) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
    });

    if (!book) {
      throw new NotFoundException('Book not found.');
    }

    if (book.authorId !== userId) {
      throw new ForbiddenException('You cannot modify this book.');
    }

    return book;
  }

  private async getActiveWallets(userId: string) {
    return this.prisma.userChainWallet.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getDefaultWallet(userId: string, walletId?: string) {
    if (walletId) {
      const wallet = await this.prisma.userChainWallet.findFirst({
        where: {
          id: walletId,
          userId,
          isActive: true,
        },
      });

      if (!wallet) {
        throw new BadRequestException('Selected wallet could not be found.');
      }

      return wallet;
    }

    const wallet = await this.prisma.userChainWallet.findFirst({
      where: {
        userId,
        isDefault: true,
        isActive: true,
      },
    });

    if (wallet) {
      return wallet;
    }

    const fallback = await this.prisma.userChainWallet.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!fallback) {
      throw new BadRequestException('No active Lesenpad wallet is available.');
    }

    return fallback;
  }

  private async ensureBookCollection(bookId: string) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
        chapters: {
          where: {
            publishedAt: {
              not: null,
            },
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!book) {
      throw new NotFoundException('Book not found.');
    }

    if (
      book.collectionMintAddress &&
      book.collectionMetadataAddress &&
      book.collectionMasterEditionAddress
    ) {
      return {
        collectionMintAddress: book.collectionMintAddress,
        collectionMetadataAddress: book.collectionMetadataAddress,
        collectionMasterEditionAddress: book.collectionMasterEditionAddress,
        collectionMetadataUri: book.collectionMetadataUri,
        collectionMetadataCid: book.collectionMetadataCid,
      };
    }

    if (
      book.collectionMintAddress ||
      book.collectionMetadataAddress ||
      book.collectionMasterEditionAddress
    ) {
      throw new BadRequestException(
        'Book collection metadata is incomplete. Repair the stored collection before publishing.',
      );
    }

    const collectionMetadata = await this.ipfsService.uploadJson(
      `${book.slug}-collection-metadata`,
      {
        name: `${book.title} Collection`,
        symbol: 'LSPAD',
        description: book.synopsis,
        image: book.coverImageUrl ?? undefined,
        properties: {
          app: 'Lesenpad',
          network: this.solanaService.getNetwork(),
          bookId: book.id,
          bookSlug: book.slug,
          authorName: book.author.displayName,
          genre: book.genre,
          tags: book.tags,
          publishedChapterCount: book.chapters.length,
        },
      },
    );
    const collectionAsset = await this.solanaService.createBookCollectionAsset({
      name: `${book.title} Collection`,
      uri: collectionMetadata.uri,
    });

    const updated = await this.prisma.book.update({
      where: { id: bookId },
      data: {
        collectionMintAddress: collectionAsset.mintAddress,
        collectionMetadataAddress: collectionAsset.metadataAddress,
        collectionMasterEditionAddress: collectionAsset.masterEditionAddress,
        collectionMetadataProvider: 'IPFS',
        collectionMetadataCid: collectionMetadata.cid,
        collectionMetadataUri:
          collectionAsset.metadataUri ?? collectionMetadata.uri,
      },
    });

    return {
      collectionMintAddress: updated.collectionMintAddress!,
      collectionMetadataAddress: updated.collectionMetadataAddress!,
      collectionMasterEditionAddress: updated.collectionMasterEditionAddress!,
      collectionMetadataUri: updated.collectionMetadataUri,
      collectionMetadataCid: updated.collectionMetadataCid,
    };
  }

  private async getOwnedChapterNumbers(bookId: string, userId?: string) {
    if (!userId) {
      return new Set<number>();
    }

    const tokens = await this.prisma.chapterToken.findMany({
      where: {
        ownerUserId: userId,
        chapter: {
          bookId,
        },
      },
      include: {
        chapter: true,
      },
    });

    const unlocked = new Set(
      tokens.map((token) => token.chapter.chapterNumber),
    );

    const entitlements = await this.prisma.entitlement.findMany({
      where: {
        userId,
        bookId,
      },
    });

    for (const entitlement of entitlements) {
      if (entitlement.fullBook) {
        const bookChapters = await this.prisma.chapter.findMany({
          where: {
            bookId,
            publishedAt: {
              not: null,
            },
          },
          select: {
            chapterNumber: true,
          },
        });

        for (const chapter of bookChapters) {
          unlocked.add(chapter.chapterNumber);
        }

        continue;
      }

      if (entitlement.chapterStart != null && entitlement.chapterEnd != null) {
        for (
          let chapterNumber = entitlement.chapterStart;
          chapterNumber <= entitlement.chapterEnd;
          chapterNumber += 1
        ) {
          unlocked.add(chapterNumber);
        }
      }
    }

    return unlocked;
  }

  private async serializePublicBook(
    book: {
      id: string;
      slug: string;
      title: string;
      genre: string;
      tags: string[];
      synopsis: string;
      coverImageUrl: string | null;
      collectionMintAddress: string | null;
      collectionMetadataAddress: string | null;
      collectionMetadataUri: string | null;
      status: BookStatus;
      author: {
        displayName: string;
      };
      chapters: Array<{
        id: string;
        title: string;
        chapterNumber: number;
        isFree: boolean;
        wordCount: number;
        estimatedReadMinutes: number;
        publishedRenderedHtml: string | null;
        publishedAt: Date | null;
        edition: {
          maxCopies: number;
          mintedCopies: number;
          priceInUsdcMinor: number;
        } | null;
      }>;
      offers: Array<{
        id: string;
        type: OfferType;
        title: string;
        description: string;
        priceInUsdcMinor: number;
        currency: string;
        chapterStart: number | null;
        chapterEnd: number | null;
      }>;
    },
    userId?: string,
  ) {
    const ownedChapterNumbers = await this.getOwnedChapterNumbers(
      book.id,
      userId,
    );

    return {
      id: book.id,
      slug: book.slug,
      title: book.title,
      genre: book.genre,
      tags: book.tags,
      synopsis: book.synopsis,
      coverImageUrl: book.coverImageUrl,
      collection:
        book.collectionMintAddress && book.collectionMetadataAddress
          ? {
              mintAddress: book.collectionMintAddress,
              metadataAddress: book.collectionMetadataAddress,
              metadataUri: book.collectionMetadataUri,
            }
          : null,
      status: book.status,
      authorName: book.author.displayName,
      chapters: book.chapters.map((chapter) => {
        const readMetrics =
          chapter.wordCount > 0
            ? {
                wordCount: chapter.wordCount,
                estimatedReadMinutes: chapter.estimatedReadMinutes,
              }
            : computeReadMetricsFromHtml(chapter.publishedRenderedHtml ?? '');

        return {
          id: chapter.id,
          title: chapter.title,
          chapterNumber: chapter.chapterNumber,
          isFree: chapter.isFree,
          wordCount: readMetrics.wordCount,
          estimatedReadMinutes: readMetrics.estimatedReadMinutes,
          isPublished: Boolean(chapter.publishedAt),
          isUnlocked:
            chapter.isFree || ownedChapterNumbers.has(chapter.chapterNumber),
          edition: chapter.edition
            ? {
                maxCopies: chapter.edition.maxCopies,
                mintedCopies: chapter.edition.mintedCopies,
                priceInUsdcMinor: chapter.edition.priceInUsdcMinor,
                formattedPrice: formatCurrency(
                  chapter.edition.priceInUsdcMinor,
                  'USDC',
                ),
              }
            : null,
        };
      }),
      offers: book.offers.map((offer) => ({
        id: offer.id,
        type: offer.type,
        title: offer.title,
        description: offer.description,
        priceInUsdcMinor: offer.priceInUsdcMinor,
        formattedPrice: formatCurrency(offer.priceInUsdcMinor, offer.currency),
        chapterStart: offer.chapterStart,
        chapterEnd: offer.chapterEnd,
      })),
    };
  }

  async getFeaturedBooks(userId?: string) {
    return this.listPublicBooks(userId, 8);
  }

  async listPublicBooks(userId?: string, take = 24) {
    const books = await this.prisma.book.findMany({
      where: {
        status: {
          not: BookStatus.DRAFT,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        author: true,
        chapters: {
          include: {
            edition: true,
          },
          orderBy: {
            chapterNumber: 'asc',
          },
        },
        offers: {
          where: {
            isActive: true,
          },
          orderBy: {
            priceInUsdcMinor: 'asc',
          },
        },
      },
      take,
    });

    return Promise.all(
      books.map((book) => this.serializePublicBook(book, userId)),
    );
  }

  async getPublicBookBySlug(slug: string, userId?: string) {
    const book = await this.prisma.book.findUnique({
      where: {
        slug,
      },
      include: {
        author: true,
        chapters: {
          include: {
            edition: true,
          },
          orderBy: {
            chapterNumber: 'asc',
          },
        },
        offers: {
          where: {
            isActive: true,
          },
          orderBy: {
            priceInUsdcMinor: 'asc',
          },
        },
      },
    });

    if (!book || book.status === BookStatus.DRAFT) {
      throw new NotFoundException('Book not found.');
    }

    return this.serializePublicBook(book, userId);
  }

  async getAuthorBooks(userId: string) {
    const books = await this.prisma.book.findMany({
      where: {
        authorId: userId,
      },
      include: {
        chapters: {
          include: {
            edition: true,
            chapterTokens: true,
          },
          orderBy: {
            chapterNumber: 'asc',
          },
        },
        offers: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        readingProgress: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return books.map((book) => ({
      id: book.id,
      title: book.title,
      slug: book.slug,
      synopsis: book.synopsis,
      coverImageUrl: book.coverImageUrl,
      collection:
        book.collectionMintAddress && book.collectionMetadataAddress
          ? {
              mintAddress: book.collectionMintAddress,
              metadataAddress: book.collectionMetadataAddress,
              metadataUri: book.collectionMetadataUri,
            }
          : null,
      status: book.status,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      chapters: book.chapters.map((chapter) => {
        const readMetrics =
          chapter.wordCount > 0
            ? {
                wordCount: chapter.wordCount,
                estimatedReadMinutes: chapter.estimatedReadMinutes,
              }
            : computeReadMetrics(chapter.draftFormat, chapter.draftContent);

        return {
          id: chapter.id,
          bookId: chapter.bookId,
          title: chapter.title,
          slug: chapter.slug,
          chapterNumber: chapter.chapterNumber,
          isFree: chapter.isFree,
          wordCount: readMetrics.wordCount,
          estimatedReadMinutes: readMetrics.estimatedReadMinutes,
          draftFormat: chapter.draftFormat,
          draftContent: chapter.draftContent,
          authorNotes: chapter.authorNotes,
          checklistItems: normalizeChecklistItems(chapter.checklistItems),
          analytics: {
            unlocks: chapter.chapterTokens.length,
            activeReaders: book.readingProgress.filter(
              (item) => item.currentChapterNumber >= chapter.chapterNumber,
            ).length,
            revenueInUsdcMinor:
              (chapter.edition?.mintedCopies ?? 0) *
              (chapter.edition?.priceInUsdcMinor ?? 0),
            offerMentions: chapter.edition ? 1 : 0,
            mintedCopies: chapter.edition?.mintedCopies ?? 0,
            maxCopies: chapter.edition?.maxCopies ?? 0,
          },
          publishedAt: chapter.publishedAt,
          edition: chapter.edition
            ? {
                id: chapter.edition.id,
                maxCopies: chapter.edition.maxCopies,
                mintedCopies: chapter.edition.mintedCopies,
                priceInUsdcMinor: chapter.edition.priceInUsdcMinor,
                sellerWalletAddress: chapter.edition.sellerWalletAddress,
              }
            : null,
          createdAt: chapter.createdAt,
          updatedAt: chapter.updatedAt,
        };
      }),
      offers: book.offers.map((offer) => ({
        id: offer.id,
        bookId: offer.bookId,
        type: offer.type,
        title: offer.title,
        description: offer.description,
        priceInUsdcMinor: offer.priceInUsdcMinor,
        chapterStart: offer.chapterStart,
        chapterEnd: offer.chapterEnd,
        isActive: offer.isActive,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
      })),
    }));
  }

  async createBook(user: SessionUser, dto: UpsertBookDto) {
    return this.prisma.book.create({
      data: {
        title: dto.title,
        slug: slugify(dto.title),
        synopsis: dto.synopsis,
        coverImageUrl: dto.coverImageUrl,
        authorId: user.id,
      },
      include: {
        chapters: {
          include: {
            edition: true,
            chapterTokens: true,
          },
        },
        offers: true,
        readingProgress: true,
      },
    });
  }

  async updateBook(userId: string, bookId: string, dto: UpsertBookDto) {
    await this.ensureBookOwner(userId, bookId);

    return this.prisma.book.update({
      where: { id: bookId },
      data: {
        title: dto.title,
        slug: slugify(dto.title),
        synopsis: dto.synopsis,
        coverImageUrl: dto.coverImageUrl,
      },
    });
  }

  async markBookComplete(userId: string, bookId: string) {
    await this.ensureBookOwner(userId, bookId);

    return this.prisma.book.update({
      where: { id: bookId },
      data: {
        status: BookStatus.COMPLETED,
      },
    });
  }

  async upsertOffer(
    userId: string,
    bookId: string,
    dto: UpsertOfferDto,
    offerId?: string,
  ) {
    await this.ensureBookOwner(userId, bookId);

    if (dto.type !== OfferType.SINGLE_CHAPTER) {
      throw new BadRequestException(
        'Lesenpad currently supports chapter-level blockchain editions only.',
      );
    }

    const existing = offerId
      ? await this.prisma.offer.findUnique({
          where: { id: offerId },
        })
      : null;

    if (offerId && !existing) {
      throw new NotFoundException('Offer not found.');
    }

    const chapter = await this.prisma.chapter.findFirst({
      where: {
        bookId,
        chapterNumber: dto.chapterStart,
      },
    });

    if (!chapter) {
      throw new BadRequestException(
        'Single chapter offers must point to a valid chapter.',
      );
    }

    return this.prisma.offer.upsert({
      where: {
        id: offerId ?? 'missing-offer-id',
      },
      update: {
        title: dto.title,
        description: dto.description,
        priceInUsdcMinor: dto.priceInUsdcMinor,
        chapterStart: dto.chapterStart,
        chapterEnd: dto.chapterEnd,
        chapterId: chapter.id,
        isActive: dto.isActive ?? true,
      },
      create: {
        bookId,
        chapterId: chapter.id,
        type: OfferType.SINGLE_CHAPTER,
        title: dto.title,
        description: dto.description,
        priceInUsdcMinor: dto.priceInUsdcMinor,
        chapterStart: dto.chapterStart,
        chapterEnd: dto.chapterEnd,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async createChapter(userId: string, bookId: string, dto: UpsertChapterDto) {
    await this.ensureBookOwner(userId, bookId);
    await this.ensureUniqueChapterNumber(bookId, dto.chapterNumber);
    const readMetrics = buildReadMetricsData(dto.draftFormat, dto.draftContent);

    return this.prisma.chapter.create({
      data: {
        bookId,
        title: dto.title,
        slug: slugify(dto.title),
        chapterNumber: dto.chapterNumber,
        isFree: dto.isFree ?? false,
        draftFormat: dto.draftFormat,
        draftContent: dto.draftContent,
        wordCount: readMetrics.wordCount,
        estimatedReadMinutes: readMetrics.estimatedReadMinutes,
        authorNotes: dto.authorNotes?.trim() || null,
        checklistItems: normalizeChecklistItems(dto.checklistItems),
      },
    });
  }

  async updateChapter(
    userId: string,
    bookId: string,
    chapterId: string,
    dto: UpsertChapterDto,
  ) {
    await this.ensureBookOwner(userId, bookId);
    await this.ensureUniqueChapterNumber(bookId, dto.chapterNumber, chapterId);
    const readMetrics = buildReadMetricsData(dto.draftFormat, dto.draftContent);

    return this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        title: dto.title,
        slug: slugify(dto.title),
        chapterNumber: dto.chapterNumber,
        draftFormat: dto.draftFormat,
        draftContent: dto.draftContent,
        wordCount: readMetrics.wordCount,
        estimatedReadMinutes: readMetrics.estimatedReadMinutes,
        isFree: dto.isFree ?? false,
        authorNotes: dto.authorNotes?.trim() || null,
        checklistItems: normalizeChecklistItems(dto.checklistItems),
      },
    });
  }

  async duplicateChapter(userId: string, bookId: string, chapterId: string) {
    await this.ensureBookOwner(userId, bookId);

    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException('Chapter not found.');
    }

    const chaptersToShift = await this.prisma.chapter.findMany({
      where: {
        bookId,
        chapterNumber: {
          gt: chapter.chapterNumber,
        },
      },
      orderBy: {
        chapterNumber: 'desc',
      },
    });

    const readMetrics = buildReadMetricsData(
      chapter.draftFormat,
      chapter.draftContent,
    );

    const duplicatedChapter = await this.prisma.$transaction([
      ...chaptersToShift.map((item) =>
        this.prisma.chapter.update({
          where: { id: item.id },
          data: {
            chapterNumber: item.chapterNumber + 1,
          },
        }),
      ),
      this.prisma.chapter.create({
        data: {
          bookId,
          title: `${chapter.title} (Copy)`,
          slug: slugify(`${chapter.title}-copy-${Date.now()}`),
          chapterNumber: chapter.chapterNumber + 1,
          isFree: chapter.isFree,
          draftFormat: chapter.draftFormat,
          draftContent: chapter.draftContent,
          wordCount: readMetrics.wordCount,
          estimatedReadMinutes: readMetrics.estimatedReadMinutes,
          authorNotes: chapter.authorNotes,
          checklistItems: normalizeChecklistItems(chapter.checklistItems),
        },
      }),
    ]);

    return duplicatedChapter[duplicatedChapter.length - 1];
  }

  async reorderChapters(
    userId: string,
    bookId: string,
    dto: ReorderChaptersDto,
  ) {
    await this.ensureBookOwner(userId, bookId);

    const chapters = await this.prisma.chapter.findMany({
      where: { bookId },
      select: { id: true },
    });
    const existingIds = new Set(chapters.map((chapter) => chapter.id));

    if (
      dto.chapterIds.length !== chapters.length ||
      dto.chapterIds.some((chapterId) => !existingIds.has(chapterId))
    ) {
      throw new BadRequestException('Chapter reorder payload is invalid.');
    }

    await this.prisma.$transaction(
      dto.chapterIds.map((chapterId, index) =>
        this.prisma.chapter.update({
          where: { id: chapterId },
          data: {
            chapterNumber: index + 1,
          },
        }),
      ),
    );

    return this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: {
        chapterNumber: 'asc',
      },
    });
  }

  private async buildEncryptedChapterPackage(chapter: {
    id: string;
    title: string;
    chapterNumber: number;
    draftFormat: string;
    draftContent: string;
    book: { title: string; slug: string };
  }) {
    const renderedHtml = renderPublishedHtml(
      chapter.draftFormat as never,
      chapter.draftContent,
    );
    const readMetrics = computeReadMetricsFromHtml(renderedHtml);
    const metadata = {
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterNumber: chapter.chapterNumber,
      bookTitle: chapter.book.title,
      bookSlug: chapter.book.slug,
      wordCount: readMetrics.wordCount,
      estimatedReadMinutes: readMetrics.estimatedReadMinutes,
    };
    const contentKey = this.vaultService.randomKey();
    const packagePayload = JSON.stringify({
      metadata,
      renderedHtml,
    });
    const encryptedBuffer = this.vaultService.encryptBuffer(
      Buffer.from(packagePayload, 'utf8'),
      contentKey,
    );
    const encryptedContentKey = this.vaultService.encryptString(
      contentKey.toString('base64'),
    );
    const plaintextHash = this.vaultService.hashString(renderedHtml);
    const ipfsPayload = JSON.stringify({
      cipherSpec: encryptedBuffer.cipherSpec,
      payload: encryptedBuffer.payload,
      metadata,
      plaintextHash,
    });
    const ipfsUpload = await this.ipfsService.uploadEncryptedPackage(
      ipfsPayload,
      `${chapter.book.slug}-chapter-${chapter.chapterNumber}-encrypted`,
    );

    return {
      renderedHtml,
      encryptedPayload: encryptedBuffer.payload,
      encryptedContentKey,
      cipherSpec: encryptedBuffer.cipherSpec,
      plaintextHash,
      wordCount: readMetrics.wordCount,
      estimatedReadMinutes: readMetrics.estimatedReadMinutes,
      ipfsCid: ipfsUpload.cid,
      ipfsUri: ipfsUpload.uri,
      storageRootHash: null,
      storageRetrievalUrl: ipfsUpload.gatewayUrl,
      storageTxHash: null,
      packageMetadata: metadata,
    };
  }

  async publishChapter(
    userId: string,
    bookId: string,
    chapterId: string,
    dto: PublishChapterDto,
  ) {
    await this.ensureBookOwner(userId, bookId);
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        book: true,
        edition: true,
      },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found.');
    }

    if (!dto.isFree) {
      if (!dto.priceInUsdcMinor || dto.priceInUsdcMinor < 1) {
        throw new BadRequestException(
          'Paid chapters must include a USDC price.',
        );
      }

      if (!dto.maxCopies || dto.maxCopies < 1) {
        throw new BadRequestException(
          'Paid chapters must include a maximum number of copies.',
        );
      }
    }

    if (
      chapter.edition &&
      dto.maxCopies &&
      dto.maxCopies !== chapter.edition.maxCopies
    ) {
      throw new BadRequestException(
        'Edition size cannot be changed after a chapter has been minted.',
      );
    }

    const sellerWallet = await this.getDefaultWallet(
      userId,
      dto.sellerWalletId,
    );
    const bookCollection = !dto.isFree
      ? await this.ensureBookCollection(chapter.bookId)
      : null;
    const encrypted = await this.buildEncryptedChapterPackage(chapter);
    const nextRevision = chapter.publishedRevision + 1;
    const publishedRevisionHash = this.vaultService.hashString(
      `${chapter.id}:${nextRevision}:${encrypted.plaintextHash}`,
    );
    const metadataUpload = !dto.isFree
      ? await this.ipfsService.uploadJson(
          `${chapter.book.slug}-chapter-${chapter.chapterNumber}-metadata`,
          {
            name: `${chapter.book.title} · Chapter ${chapter.chapterNumber}: ${chapter.title}`,
            symbol: 'LSPAD',
            description: `${chapter.title} is a capped Lesenpad chapter edition for ${chapter.book.title}.`,
            image: chapter.book.coverImageUrl ?? undefined,
            external_url: encrypted.ipfsUri,
            properties: {
              app: 'Lesenpad',
              network: this.solanaService.getNetwork(),
              encryptedContentCid: encrypted.ipfsCid,
              encryptedContentProvider: 'IPFS',
              encryptedContentUrl:
                encrypted.storageRetrievalUrl ?? encrypted.ipfsUri,
              plaintextHash: encrypted.plaintextHash,
              bookSlug: chapter.book.slug,
              chapterNumber: chapter.chapterNumber,
              sourceFormat: chapter.draftFormat,
              bookCollectionMintAddress:
                bookCollection?.collectionMintAddress ?? null,
            },
          },
        )
      : null;
    let editionAsset = null;

    if (chapter.edition) {
      if (
        bookCollection &&
        chapter.edition.collectionMintAddress &&
        chapter.edition.collectionMintAddress !==
          bookCollection.collectionMintAddress
      ) {
        throw new BadRequestException(
          'This chapter edition is already linked to a different book collection.',
        );
      }

      if (bookCollection && !chapter.edition.collectionMintAddress) {
        const collectionVerification =
          await this.solanaService.attachNftToCollection({
            nftMetadataAddress: chapter.edition.metadataAddress,
            collectionMintAddress: bookCollection.collectionMintAddress,
          });

        editionAsset = {
          masterMintAddress: chapter.edition.masterMintAddress,
          metadataAddress: chapter.edition.metadataAddress,
          masterEditionAddress: chapter.edition.masterEditionAddress ?? null,
          metadataUri:
            chapter.edition.metadataUri ?? metadataUpload?.uri ?? null,
          collectionMintAddress: bookCollection.collectionMintAddress,
          signature: collectionVerification.signature,
          confirmationSlot: collectionVerification.confirmationSlot,
          blockTime: collectionVerification.blockTime,
        };
      } else {
        editionAsset = {
          masterMintAddress: chapter.edition.masterMintAddress,
          metadataAddress: chapter.edition.metadataAddress,
          masterEditionAddress: chapter.edition.masterEditionAddress ?? null,
          metadataUri:
            chapter.edition.metadataUri ?? metadataUpload?.uri ?? null,
          collectionMintAddress: chapter.edition.collectionMintAddress ?? null,
          signature: `metadata-existing-${chapter.edition.masterMintAddress}-${nextRevision}`,
          confirmationSlot: null,
          blockTime: null,
        };
      }
    } else if (!dto.isFree && metadataUpload) {
      editionAsset = await this.solanaService.createChapterEditionAsset({
        name: `${chapter.book.title} Ch. ${chapter.chapterNumber}`,
        uri: metadataUpload.uri,
        maxCopies: dto.maxCopies!,
        collectionMintAddress: bookCollection?.collectionMintAddress,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          isFree: dto.isFree,
          publishedAt: new Date(),
          publishedRevision: nextRevision,
          publishedFormat: chapter.draftFormat,
          publishedContent: chapter.draftContent,
          publishedRenderedHtml: encrypted.renderedHtml,
          wordCount: encrypted.wordCount,
          estimatedReadMinutes: encrypted.estimatedReadMinutes,
        },
      });

      await tx.encryptedChapterBlob.create({
        data: {
          chapterId,
          revision: nextRevision,
          storageProvider: 'IPFS',
          storageRootHash: encrypted.storageRootHash,
          storageRetrievalUrl: encrypted.storageRetrievalUrl,
          ipfsCid: encrypted.ipfsCid,
          encryptedContentKey: encrypted.encryptedContentKey,
          encryptedPayloadBase64: encrypted.encryptedPayload,
          cipherSpec: encrypted.cipherSpec,
          plaintextHash: encrypted.plaintextHash,
          metadataJson: {
            sellerWalletAddress: sellerWallet.address,
            network: this.solanaService.getNetwork(),
            ipfsUri: encrypted.ipfsUri,
            storageProvider: 'IPFS',
            bookCollectionMintAddress:
              bookCollection?.collectionMintAddress ?? null,
          },
        },
      });

      if (dto.isFree) {
        await tx.chapterEdition.deleteMany({
          where: {
            chapterId,
            mintedCopies: 0,
          },
        });
        await tx.offer.deleteMany({
          where: {
            chapterId,
            type: OfferType.SINGLE_CHAPTER,
          },
        });
      } else {
        if (!editionAsset || !metadataUpload) {
          throw new BadRequestException(
            'Paid chapter publishing requires onchain edition metadata.',
          );
        }

        await tx.chapterEdition.upsert({
          where: {
            chapterId,
          },
          update: {
            metadataAddress: editionAsset.metadataAddress,
            masterEditionAddress: editionAsset.masterEditionAddress,
            metadataProvider: 'IPFS',
            metadataCid: metadataUpload.cid,
            metadataUri: editionAsset.metadataUri ?? metadataUpload.uri,
            collectionMintAddress: editionAsset.collectionMintAddress,
            priceInUsdcMinor: dto.priceInUsdcMinor!,
            sellerWalletAddress: sellerWallet.address,
            maxCopies: chapter.edition?.maxCopies ?? dto.maxCopies!,
            ipfsCid: encrypted.ipfsCid,
            publishedRevisionHash,
            isActive: true,
          },
          create: {
            chapterId,
            masterMintAddress: editionAsset.masterMintAddress,
            metadataAddress: editionAsset.metadataAddress,
            masterEditionAddress: editionAsset.masterEditionAddress,
            metadataProvider: 'IPFS',
            metadataCid: metadataUpload.cid,
            metadataUri: editionAsset.metadataUri ?? metadataUpload.uri,
            collectionMintAddress: editionAsset.collectionMintAddress,
            maxCopies: dto.maxCopies!,
            priceInUsdcMinor: dto.priceInUsdcMinor!,
            sellerWalletAddress: sellerWallet.address,
            ipfsCid: encrypted.ipfsCid,
            publishedRevisionHash,
          },
        });

        await tx.offer.upsert({
          where: {
            chapterId,
          },
          update: {
            title: `Chapter ${chapter.chapterNumber}`,
            description: `${chapter.title} · limited onchain edition`,
            type: OfferType.SINGLE_CHAPTER,
            priceInUsdcMinor: dto.priceInUsdcMinor!,
            currency: 'USDC',
            chapterStart: chapter.chapterNumber,
            chapterEnd: chapter.chapterNumber,
            isActive: true,
          },
          create: {
            bookId,
            chapterId,
            type: OfferType.SINGLE_CHAPTER,
            title: `Chapter ${chapter.chapterNumber}`,
            description: `${chapter.title} · limited onchain edition`,
            priceInUsdcMinor: dto.priceInUsdcMinor!,
            currency: 'USDC',
            chapterStart: chapter.chapterNumber,
            chapterEnd: chapter.chapterNumber,
            isActive: true,
          },
        });
      }

      await tx.book.update({
        where: { id: bookId },
        data: {
          status:
            chapter.book.status === BookStatus.COMPLETED
              ? BookStatus.COMPLETED
              : BookStatus.PUBLISHED,
        },
      });

      await tx.onchainTransaction.create({
        data: {
          signature:
            editionAsset?.signature ??
            `free-publish-${chapterId}-${nextRevision}`,
          network: this.solanaService.getNetwork(),
          txType: dto.isFree ? 'METADATA_CREATE' : 'MASTER_EDITION_CREATE',
          status: 'CONFIRMED',
          slot: editionAsset?.confirmationSlot ?? undefined,
          blockTime: editionAsset?.blockTime ?? undefined,
          confirmationCommitment:
            this.solanaService.getConfirmationCommitment(),
          metadataJson: {
            metadataUri: metadataUpload?.uri,
            metadataCid: metadataUpload?.cid,
            encryptedContentCid: encrypted.ipfsCid,
            encryptedContentProvider: 'IPFS',
            encryptedContentUrl:
              encrypted.storageRetrievalUrl ?? encrypted.ipfsUri,
            masterMintAddress: editionAsset?.masterMintAddress,
            masterEditionAddress: editionAsset?.masterEditionAddress,
            collectionMintAddress: editionAsset?.collectionMintAddress,
            collectionMetadataUri: bookCollection?.collectionMetadataUri,
          },
          userId,
          bookId,
          chapterId,
        },
      });
    });

    return this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        edition: true,
        chapterTokens: true,
      },
    });
  }

  async deleteChapter(userId: string, bookId: string, chapterId: string) {
    await this.ensureBookOwner(userId, bookId);

    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        edition: true,
      },
    });

    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException('Chapter not found.');
    }

    if (chapter.publishedAt || chapter.edition) {
      throw new BadRequestException(
        'Published or tokenized chapters cannot be deleted from the studio.',
      );
    }

    await this.prisma.chapter.delete({
      where: { id: chapterId },
    });

    const remainingChapters = await this.prisma.chapter.findMany({
      where: { bookId },
      orderBy: {
        chapterNumber: 'asc',
      },
    });

    await this.prisma.$transaction(
      remainingChapters.map((item, index) =>
        this.prisma.chapter.update({
          where: { id: item.id },
          data: {
            chapterNumber: index + 1,
          },
        }),
      ),
    );

    return { success: true };
  }

  private async resolveOwnedToken(
    chapterId: string,
    userId?: string,
  ): Promise<{
    ownerWalletAddress: string | null;
    owned: boolean;
  }> {
    if (!userId) {
      return {
        ownerWalletAddress: null,
        owned: false,
      };
    }

    const token = await this.prisma.chapterToken.findFirst({
      where: {
        chapterId,
        ownerUserId: userId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!token) {
      const chapter = await this.prisma.chapter.findUnique({
        where: {
          id: chapterId,
        },
        select: {
          chapterNumber: true,
          bookId: true,
        },
      });
      if (!chapter) {
        return {
          ownerWalletAddress: null,
          owned: false,
        };
      }

      const entitlements = await this.prisma.entitlement.findMany({
        where: {
          userId,
          bookId: chapter.bookId,
        },
      });

      const legacyUnlocked = entitlements.some((entitlement) => {
        if (entitlement.fullBook) {
          return true;
        }

        return (
          entitlement.chapterStart != null &&
          entitlement.chapterEnd != null &&
          chapter.chapterNumber >= entitlement.chapterStart &&
          chapter.chapterNumber <= entitlement.chapterEnd
        );
      });

      return {
        ownerWalletAddress: null,
        owned: legacyUnlocked,
      };
    }

    await this.prisma.ownershipVerificationCache.upsert({
      where: {
        walletAddress_chapterTokenMint: {
          walletAddress: token.ownerWalletAddress,
          chapterTokenMint: token.mintAddress,
        },
      },
      update: {
        verifiedOwner: true,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      create: {
        walletAddress: token.ownerWalletAddress,
        chapterTokenMint: token.mintAddress,
        verifiedOwner: true,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return {
      ownerWalletAddress: token.ownerWalletAddress,
      owned: true,
    };
  }

  async getReaderChapter(
    slug: string,
    chapterNumber: number,
    userId?: string,
  ): Promise<ReaderChapterDto> {
    const book = await this.prisma.book.findUnique({
      where: { slug },
      include: {
        chapters: {
          include: {
            edition: true,
            encryptedBlobs: {
              orderBy: {
                revision: 'desc',
              },
            },
          },
          orderBy: {
            chapterNumber: 'asc',
          },
        },
      },
    });

    if (!book || book.status === BookStatus.DRAFT) {
      throw new NotFoundException('Book not found.');
    }

    const chapter = book.chapters.find(
      (item) => item.chapterNumber === chapterNumber,
    );

    if (!chapter || !chapter.publishedAt) {
      throw new NotFoundException('Chapter not found.');
    }

    const ownership = await this.resolveOwnedToken(chapter.id, userId);
    const unlocked = chapter.isFree || ownership.owned;

    if (!unlocked) {
      throw new ForbiddenException(
        'Own this chapter asset to continue reading.',
      );
    }

    let renderedHtml = chapter.publishedRenderedHtml ?? '';

    if (!chapter.isFree) {
      const latestBlob = chapter.encryptedBlobs.find(
        (item) => item.revision === chapter.publishedRevision,
      );

      if (latestBlob) {
        try {
          const packagePayload =
            latestBlob.storageProvider === 'IPFS' && latestBlob.ipfsCid
              ? getEncryptedPackagePayload(
                  await this.ipfsService.downloadEncryptedPackage(
                    latestBlob.ipfsCid,
                  ),
                  latestBlob.encryptedPayloadBase64,
                )
              : latestBlob.encryptedPayloadBase64;
          const contentKey = Buffer.from(
            this.vaultService.decryptString(latestBlob.encryptedContentKey),
            'base64',
          );
          const decrypted = this.vaultService.decryptBuffer(
            packagePayload,
            contentKey,
          );
          const payload = JSON.parse(decrypted.toString('utf8')) as {
            renderedHtml: string;
          };
          renderedHtml = payload.renderedHtml;
        } catch (error) {
          this.logger.warn(
            `Failed to decrypt chapter blob ${latestBlob.id} for chapter ${chapter.id}; falling back to published snapshot.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    const readMetrics =
      chapter.wordCount > 0
        ? {
            wordCount: chapter.wordCount,
            estimatedReadMinutes: chapter.estimatedReadMinutes,
          }
        : computeReadMetricsFromHtml(renderedHtml);

    return {
      bookTitle: book.title,
      chapterTitle: chapter.title,
      chapterNumber: chapter.chapterNumber,
      wordCount: readMetrics.wordCount,
      estimatedReadMinutes: readMetrics.estimatedReadMinutes,
      renderedHtml,
      progressPercent: Math.round(
        (chapter.chapterNumber / Math.max(book.chapters.length, 1)) * 100,
      ),
      ownership: {
        required: !chapter.isFree,
        owned: chapter.isFree || ownership.owned,
        ownerWalletAddress: ownership.ownerWalletAddress,
        editionSupply: chapter.edition
          ? {
              mintedCopies: chapter.edition.mintedCopies,
              maxCopies: chapter.edition.maxCopies,
            }
          : null,
      },
    };
  }

  async upsertProgress(userId: string, dto: UpsertProgressDto) {
    await this.prisma.readingProgress.upsert({
      where: {
        userId_bookId: {
          userId,
          bookId: dto.bookId,
        },
      },
      update: {
        currentChapterNumber: dto.currentChapterNumber,
        currentPage: dto.currentPage,
        progressPercent: dto.progressPercent,
      },
      create: {
        userId,
        bookId: dto.bookId,
        currentChapterNumber: dto.currentChapterNumber,
        currentPage: dto.currentPage,
        progressPercent: dto.progressPercent,
      },
    });

    await this.prisma.libraryItem.upsert({
      where: {
        userId_bookId: {
          userId,
          bookId: dto.bookId,
        },
      },
      update: {
        lastOpenedChapter: dto.currentChapterNumber,
        lastOpenedAt: new Date(),
      },
      create: {
        userId,
        bookId: dto.bookId,
        lastOpenedChapter: dto.currentChapterNumber,
        lastOpenedAt: new Date(),
      },
    });

    return { success: true };
  }
}
