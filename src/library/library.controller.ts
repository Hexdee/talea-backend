import { Body, Controller, Get, Put, UseGuards, Version } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { BooksService } from '../books/books.service';
import { LibraryService } from './library.service';
import { UpsertProgressDto } from '../books/dto/book.dto';

@ApiTags('library')
@Controller('library')
@UseGuards(SessionAuthGuard)
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly booksService: BooksService,
  ) {}

  @Get()
  @Version('1')
  getLibrary(@CurrentUser() user: SessionUser) {
    return this.libraryService.getLibrary(user.id);
  }

  @Get('entitlements')
  @Version('1')
  getEntitlements(@CurrentUser() user: SessionUser) {
    return this.libraryService.getEntitlements(user.id);
  }

  @Put('progress')
  @Version('1')
  upsertProgress(
    @CurrentUser() user: SessionUser,
    @Body() dto: UpsertProgressDto,
  ) {
    return this.booksService.upsertProgress(user.id, dto);
  }
}
