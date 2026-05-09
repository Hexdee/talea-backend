import { BadRequestException, Injectable } from '@nestjs/common';
import { BookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FEATURED_BOOKS = 24;

@Injectable()
export class FeaturedBooksAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listFeaturedBooks() {
    const featured = await this.prisma.featuredBook.findMany({
      orderBy: { rank: 'asc' },
      include: {
        book: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            coverImageUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    return featured.map((item) => ({
      rank: item.rank,
      bookId: item.bookId,
      book: item.book,
    }));
  }

  async setFeaturedBooks(bookIds: string[]) {
    const normalized = bookIds.slice(0, MAX_FEATURED_BOOKS);

    if (normalized.length !== bookIds.length) {
      throw new BadRequestException(
        `Featured list is capped at ${MAX_FEATURED_BOOKS} books.`,
      );
    }

    const books = await this.prisma.book.findMany({
      where: {
        id: {
          in: normalized,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    const bookById = new Map(books.map((book) => [book.id, book]));
    const missing = normalized.filter((bookId) => !bookById.has(bookId));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Featured list contains unknown book ids: ${missing.join(', ')}`,
      );
    }

    const draftIds = normalized.filter(
      (bookId) => bookById.get(bookId)?.status === BookStatus.DRAFT,
    );
    if (draftIds.length > 0) {
      throw new BadRequestException(
        `Draft books cannot be featured: ${draftIds.join(', ')}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.featuredBook.deleteMany({});

      if (normalized.length > 0) {
        await tx.featuredBook.createMany({
          data: normalized.map((bookId, index) => ({
            bookId,
            rank: index + 1,
          })),
        });
      }
    });

    return this.listFeaturedBooks();
  }
}
