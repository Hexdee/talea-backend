import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookStatus, OfferType, Role } from '@prisma/client';
import type { SessionUser } from '../common/types/authenticated-request';
import { renderPublishedHtml } from '../common/utils/content';
import { formatCurrency } from '../common/utils/currency';
import { PrismaService } from '../prisma/prisma.service';
import {
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

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

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

  private async getBookAccessMap(bookId: string, userId?: string) {
    if (!userId) {
      return new Set<number>();
    }

    const entitlements = await this.prisma.entitlement.findMany({
      where: {
        userId,
        bookId,
      },
    });

    const unlocked = new Set<number>();

    for (const entitlement of entitlements) {
      if (entitlement.fullBook) {
        unlocked.add(-1);
        continue;
      }

      if (
        entitlement.chapterStart !== null &&
        entitlement.chapterEnd !== null &&
        entitlement.chapterStart !== undefined &&
        entitlement.chapterEnd !== undefined
      ) {
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
          orderBy: {
            chapterNumber: 'asc',
          },
        },
        offers: {
          where: {
            isActive: true,
          },
          orderBy: {
            priceInKobo: 'asc',
          },
        },
      },
      take,
    });

    const accessMaps = new Map<string, Set<number>>();

    for (const book of books) {
      accessMaps.set(book.id, await this.getBookAccessMap(book.id, userId));
    }

    return books.map((book) => {
      const unlocked = accessMaps.get(book.id) ?? new Set<number>();

      return {
        id: book.id,
        slug: book.slug,
        title: book.title,
        genre: book.genre,
        tags: book.tags,
        synopsis: book.synopsis,
        coverImageUrl: book.coverImageUrl,
        status: book.status,
        authorName: book.author.displayName,
        chapters: book.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          chapterNumber: chapter.chapterNumber,
          isFree: chapter.isFree,
          isPublished: Boolean(chapter.publishedAt),
          isUnlocked:
            chapter.isFree ||
            unlocked.has(-1) ||
            unlocked.has(chapter.chapterNumber),
        })),
        offers: book.offers.map((offer) => ({
          id: offer.id,
          type: offer.type,
          title: offer.title,
          description: offer.description,
          priceInKobo: offer.priceInKobo,
          formattedPrice: formatCurrency(offer.priceInKobo, offer.currency),
          chapterStart: offer.chapterStart,
          chapterEnd: offer.chapterEnd,
        })),
      };
    });
  }

  async getPublicBookBySlug(slug: string, userId?: string) {
    const books = await this.listPublicBooks(userId);
    const book = books.find((item) => item.slug === slug);

    if (!book) {
      throw new NotFoundException('Book not found.');
    }

    return book;
  }

  async getAuthorBooks(userId: string) {
    const books = await this.prisma.book.findMany({
      where: {
        authorId: userId,
      },
      include: {
        chapters: {
          orderBy: {
            chapterNumber: 'asc',
          },
        },
        offers: {
          include: {
            orderItems: {
              include: {
                order: {
                  include: {
                    payment: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        entitlements: true,
        readingProgress: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return books.map((book) => ({
      ...book,
      chapters: book.chapters.map((chapter) => {
        const matchingOffers = book.offers.filter((offer) => {
          if (offer.type === OfferType.FULL_BOOK) {
            return true;
          }

          if (
            offer.chapterStart === null ||
            offer.chapterEnd === null ||
            offer.chapterStart === undefined ||
            offer.chapterEnd === undefined
          ) {
            return false;
          }

          return (
            chapter.chapterNumber >= offer.chapterStart &&
            chapter.chapterNumber <= offer.chapterEnd
          );
        });

        const unlocks = book.entitlements.filter((entitlement) => {
          if (entitlement.fullBook) {
            return true;
          }

          if (
            entitlement.chapterStart === null ||
            entitlement.chapterEnd === null ||
            entitlement.chapterStart === undefined ||
            entitlement.chapterEnd === undefined
          ) {
            return false;
          }

          return (
            chapter.chapterNumber >= entitlement.chapterStart &&
            chapter.chapterNumber <= entitlement.chapterEnd
          );
        }).length;

        const activeReaders = book.readingProgress.filter(
          (progress) => progress.currentChapterNumber >= chapter.chapterNumber,
        ).length;

        const revenueInKobo = matchingOffers.reduce((sum, offer) => {
          const coveredChapterCount =
            offer.type === OfferType.FULL_BOOK
              ? Math.max(book.chapters.length, 1)
              : Math.max(
                  (offer.chapterEnd ?? chapter.chapterNumber) -
                    (offer.chapterStart ?? chapter.chapterNumber) +
                    1,
                  1,
                );

          const offerRevenue = offer.orderItems.reduce(
            (orderSum, orderItem) => {
              if (
                orderItem.order.status !== 'COMPLETED' &&
                orderItem.order.payment?.status !== 'SUCCEEDED'
              ) {
                return orderSum;
              }

              return (
                orderSum +
                Math.round(orderItem.amountInKobo / coveredChapterCount)
              );
            },
            0,
          );

          return sum + offerRevenue;
        }, 0);

        return {
          ...chapter,
          checklistItems: normalizeChecklistItems(chapter.checklistItems),
          analytics: {
            unlocks,
            activeReaders,
            revenueInKobo,
            offerMentions: matchingOffers.length,
          },
        };
      }),
      offers: book.offers.map((offer) => ({
        id: offer.id,
        bookId: offer.bookId,
        type: offer.type,
        title: offer.title,
        description: offer.description,
        priceInKobo: offer.priceInKobo,
        currency: offer.currency,
        chapterStart: offer.chapterStart,
        chapterEnd: offer.chapterEnd,
        isActive: offer.isActive,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
      })),
    }));
  }

  async createBook(user: SessionUser, dto: UpsertBookDto) {
    const slug = slugify(dto.title);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        roles: user.roles.includes(Role.AUTHOR)
          ? user.roles
          : [...user.roles, Role.AUTHOR],
      },
    });

    return this.prisma.book.create({
      data: {
        title: dto.title,
        slug,
        synopsis: dto.synopsis,
        coverImageUrl: dto.coverImageUrl,
        authorId: user.id,
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
    const chapters = await this.prisma.chapter.findMany({
      where: { bookId },
    });

    if (chapters.some((chapter) => !chapter.publishedAt)) {
      throw new BadRequestException(
        'Publish every chapter before completing the book.',
      );
    }

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
    const book = await this.ensureBookOwner(userId, bookId);

    if (
      dto.type === OfferType.FULL_BOOK &&
      book.status !== BookStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Full-book offers are only allowed for completed books.',
      );
    }

    if (
      dto.type !== OfferType.FULL_BOOK &&
      (!dto.chapterStart || !dto.chapterEnd)
    ) {
      throw new BadRequestException(
        'Chapter-based offers require a chapter range.',
      );
    }

    if (
      dto.type !== OfferType.FULL_BOOK &&
      dto.chapterStart &&
      dto.chapterEnd &&
      dto.chapterStart > dto.chapterEnd
    ) {
      throw new BadRequestException(
        'Chapter start cannot be greater than chapter end.',
      );
    }

    const chapterNumbers = bookId
      ? await this.prisma.chapter.findMany({
          where: { bookId },
          select: { chapterNumber: true },
        })
      : [];
    const availableChapterNumbers = new Set(
      chapterNumbers.map((chapter) => chapter.chapterNumber),
    );

    if (
      dto.type !== OfferType.FULL_BOOK &&
      dto.chapterStart &&
      dto.chapterEnd &&
      (!availableChapterNumbers.has(dto.chapterStart) ||
        !availableChapterNumbers.has(dto.chapterEnd))
    ) {
      throw new BadRequestException(
        'Offer chapter range must match existing chapters.',
      );
    }

    const data = {
      type: dto.type,
      title: dto.title,
      description: dto.description,
      priceInKobo: dto.priceInKobo,
      chapterStart: dto.chapterStart,
      chapterEnd: dto.chapterEnd,
      isActive: dto.isActive ?? true,
    };

    if (offerId) {
      return this.prisma.offer.update({
        where: { id: offerId },
        data,
      });
    }

    return this.prisma.offer.create({
      data: {
        ...data,
        bookId,
      },
    });
  }

  async createChapter(userId: string, bookId: string, dto: UpsertChapterDto) {
    await this.ensureBookOwner(userId, bookId);
    await this.ensureUniqueChapterNumber(bookId, dto.chapterNumber);

    return this.prisma.chapter.create({
      data: {
        bookId,
        title: dto.title,
        slug: slugify(dto.title),
        chapterNumber: dto.chapterNumber,
        draftFormat: dto.draftFormat,
        draftContent: dto.draftContent,
        isFree: dto.isFree ?? false,
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

    return this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        title: dto.title,
        slug: slugify(dto.title),
        chapterNumber: dto.chapterNumber,
        draftFormat: dto.draftFormat,
        draftContent: dto.draftContent,
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

  async publishChapter(userId: string, bookId: string, chapterId: string) {
    await this.ensureBookOwner(userId, bookId);
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter) {
      throw new NotFoundException('Chapter not found.');
    }

    const publishedRenderedHtml = renderPublishedHtml(
      chapter.draftFormat,
      chapter.draftContent,
    );

    await this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        publishedAt: new Date(),
        publishedFormat: chapter.draftFormat,
        publishedContent: chapter.draftContent,
        publishedRenderedHtml,
      },
    });

    await this.prisma.book.update({
      where: { id: bookId },
      data: {
        status: BookStatus.PUBLISHED,
      },
    });

    return this.prisma.chapter.findUnique({
      where: { id: chapterId },
    });
  }

  async deleteChapter(userId: string, bookId: string, chapterId: string) {
    await this.ensureBookOwner(userId, bookId);

    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException('Chapter not found.');
    }

    if (chapter.publishedAt) {
      throw new BadRequestException(
        'Published chapters cannot be deleted from the studio.',
      );
    }

    const relatedOffers = await this.prisma.offer.findFirst({
      where: {
        bookId,
        type: {
          not: OfferType.FULL_BOOK,
        },
        chapterStart: {
          lte: chapter.chapterNumber,
        },
        chapterEnd: {
          gte: chapter.chapterNumber,
        },
        isActive: true,
      },
    });

    if (relatedOffers) {
      throw new BadRequestException(
        'Deactivate chapter offers touching this chapter before deleting it.',
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

  async getReaderChapter(
    slug: string,
    chapterNumber: number,
    userId?: string,
  ): Promise<ReaderChapterDto> {
    const book = await this.prisma.book.findUnique({
      where: { slug },
      include: {
        chapters: {
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

    if (!chapter || !chapter.publishedAt || !chapter.publishedRenderedHtml) {
      throw new NotFoundException('Chapter not found.');
    }

    const accessMap = await this.getBookAccessMap(book.id, userId);
    const unlocked =
      chapter.isFree ||
      accessMap.has(-1) ||
      accessMap.has(chapter.chapterNumber);

    if (!unlocked) {
      throw new ForbiddenException(
        'Purchase this chapter or bundle to continue.',
      );
    }

    return {
      bookTitle: book.title,
      chapterTitle: chapter.title,
      chapterNumber: chapter.chapterNumber,
      renderedHtml: chapter.publishedRenderedHtml,
      progressPercent: Math.round(
        (chapter.chapterNumber / book.chapters.length) * 100,
      ),
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
