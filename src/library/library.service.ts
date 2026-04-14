import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
