import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PINNED_BOOKS = 3;

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async getLibrary(userId: string) {
    return this.prisma.libraryItem.findMany({
      where: {
        userId,
      },
      include: {
        book: {
          include: {
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
            },
          },
        },
      },
      orderBy: {
        addedAt: 'desc',
      },
    });
  }

  async getEntitlements(userId: string) {
    return this.prisma.chapterToken.findMany({
      where: {
        ownerUserId: userId,
      },
      include: {
        chapter: {
          include: {
            book: true,
            offer: true,
          },
        },
        edition: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async pinBook(userId: string, bookId: string) {
    const item = await this.prisma.libraryItem.findUnique({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      select: {
        pinnedAt: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Book not found in library.');
    }

    if (item.pinnedAt) {
      return { success: true };
    }

    const pinnedCount = await this.prisma.libraryItem.count({
      where: {
        userId,
        pinnedAt: {
          not: null,
        },
      },
    });

    if (pinnedCount >= MAX_PINNED_BOOKS) {
      throw new BadRequestException(
        `You can pin up to ${MAX_PINNED_BOOKS} books.`,
      );
    }

    await this.prisma.libraryItem.update({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      data: {
        pinnedAt: new Date(),
      },
    });

    return { success: true };
  }

  async unpinBook(userId: string, bookId: string) {
    const item = await this.prisma.libraryItem.findUnique({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      select: {
        pinnedAt: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Book not found in library.');
    }

    if (!item.pinnedAt) {
      return { success: true };
    }

    await this.prisma.libraryItem.update({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      data: {
        pinnedAt: null,
      },
    });

    return { success: true };
  }
}
