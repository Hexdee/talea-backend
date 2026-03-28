import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalSessionAuthGuard } from '../auth/guards/optional-session-auth.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { BooksService } from '../books/books.service';
import { ReorderChaptersDto, UpsertChapterDto } from '../books/dto/book.dto';

@ApiTags('chapters')
@Controller()
export class ChaptersController {
  constructor(private readonly booksService: BooksService) {}

  @Post('books/:bookId/chapters')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  createChapter(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Body() dto: UpsertChapterDto,
  ) {
    return this.booksService.createChapter(user.id, bookId, dto);
  }

  @Patch('books/:bookId/chapters/:chapterId')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  updateChapter(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: UpsertChapterDto,
  ) {
    return this.booksService.updateChapter(user.id, bookId, chapterId, dto);
  }

  @Post('books/:bookId/chapters/reorder')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  reorderChapters(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Body() dto: ReorderChaptersDto,
  ) {
    return this.booksService.reorderChapters(user.id, bookId, dto);
  }

  @Post('books/:bookId/chapters/:chapterId/publish')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  publishChapter(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.booksService.publishChapter(user.id, bookId, chapterId);
  }

  @Post('books/:bookId/chapters/:chapterId/duplicate')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  duplicateChapter(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.booksService.duplicateChapter(user.id, bookId, chapterId);
  }

  @Delete('books/:bookId/chapters/:chapterId')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  deleteChapter(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.booksService.deleteChapter(user.id, bookId, chapterId);
  }

  @Get('reader/:slug/chapters/:chapterNumber')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  getReaderChapter(
    @Param('slug') slug: string,
    @Param('chapterNumber') chapterNumber: string,
    @CurrentUser() user: SessionUser | null,
  ) {
    return this.booksService.getReaderChapter(
      slug,
      Number(chapterNumber),
      user?.id,
    );
  }
}
