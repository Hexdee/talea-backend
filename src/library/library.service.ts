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
    return this.prisma.entitlement.findMany({
      where: {
        userId,
      },
      include: {
        offer: true,
        book: true,
      },
      orderBy: {
        grantedAt: 'desc',
      },
    });
  }
}
