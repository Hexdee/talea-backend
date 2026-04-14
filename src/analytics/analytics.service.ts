import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string) {
    const books = await this.prisma.book.findMany({
      where: {
        authorId: userId,
      },
      include: {
        analyticsMetrics: true,
        chapters: true,
        offers: true,
      },
    });

    const revenueInUsdcMinor = books
      .flatMap((book) => book.analyticsMetrics)
      .reduce((sum, item) => sum + item.revenueInUsdcMinor, 0);
    const purchases = books
      .flatMap((book) => book.analyticsMetrics)
      .reduce((sum, item) => sum + item.purchases, 0);

    return {
      bookCount: books.length,
      publishedChapterCount: books
        .flatMap((book) => book.chapters)
        .filter((chapter) => chapter.publishedAt).length,
      revenueInUsdcMinor,
      purchases,
      books: books.map((book) => ({
        id: book.id,
        title: book.title,
        status: book.status,
        purchases: book.analyticsMetrics.reduce(
          (sum, item) => sum + item.purchases,
          0,
        ),
        revenueInUsdcMinor: book.analyticsMetrics.reduce(
          (sum, item) => sum + item.revenueInUsdcMinor,
          0,
        ),
      })),
    };
  }

  async getBookAnalytics(userId: string, bookId: string) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        analyticsMetrics: {
          orderBy: { date: 'asc' },
        },
        chapters: true,
      },
    });

    if (!book || book.authorId !== userId) {
      throw new ForbiddenException('You cannot view analytics for this book.');
    }

    return {
      id: book.id,
      title: book.title,
      status: book.status,
      snapshots: book.analyticsMetrics,
      chapters: book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        chapterNumber: chapter.chapterNumber,
        isPublished: Boolean(chapter.publishedAt),
      })),
    };
  }
}
