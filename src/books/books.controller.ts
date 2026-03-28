import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalSessionAuthGuard } from '../auth/guards/optional-session-auth.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { BooksService } from './books.service';
import { UpsertBookDto, UpsertOfferDto } from './dto/book.dto';

const uploadRoot = join(process.cwd(), 'uploads');

function ensureUploadDirectory(directory: string) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

function buildUploadStorage(folder: string) {
  return diskStorage({
    destination: (_request, _file, callback) => {
      callback(null, ensureUploadDirectory(join(uploadRoot, folder)));
    },
    filename: (_request, file, callback) => {
      const safeName = file.originalname
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 48);

      callback(
        null,
        `${Date.now()}-${safeName || 'asset'}${extname(file.originalname).toLowerCase()}`,
      );
    },
  });
}

function buildAbsoluteUploadUrl(request: Request, relativePath: string) {
  const publicBaseUrl = process.env.BACKEND_PUBLIC_URL?.trim();

  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}${relativePath}`;
  }

  const forwardedProto = request.header('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0] ?? request.protocol;

  return `${protocol}://${request.get('host')}${relativePath}`;
}

function ensureImageFile(file?: Express.Multer.File): Express.Multer.File {
  if (!file) {
    throw new BadRequestException('No file received.');
  }

  if (!file.mimetype.startsWith('image/')) {
    throw new BadRequestException('Only image uploads are allowed for covers.');
  }

  return file;
}

function ensureEditorMediaFile(
  file?: Express.Multer.File,
): Express.Multer.File {
  if (!file) {
    throw new BadRequestException('No file received.');
  }

  if (
    !file.mimetype.startsWith('image/') &&
    !file.mimetype.startsWith('video/')
  ) {
    throw new BadRequestException(
      'Only image or video uploads are allowed for editor media.',
    );
  }

  return file;
}

@ApiTags('books')
@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get('featured')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  getFeaturedBooks(@CurrentUser() user: SessionUser | null) {
    return this.booksService.getFeaturedBooks(user?.id);
  }

  @Get('public')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  listPublicBooks(@CurrentUser() user: SessionUser | null) {
    return this.booksService.listPublicBooks(user?.id);
  }

  @Get('public/:slug')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  getPublicBook(
    @Param('slug') slug: string,
    @CurrentUser() user: SessionUser | null,
  ) {
    return this.booksService.getPublicBookBySlug(slug, user?.id);
  }

  @Get('author')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  getAuthorBooks(@CurrentUser() user: SessionUser) {
    return this.booksService.getAuthorBooks(user.id);
  }

  @Post()
  @Version('1')
  @UseGuards(SessionAuthGuard)
  createBook(@CurrentUser() user: SessionUser, @Body() dto: UpsertBookDto) {
    return this.booksService.createBook(user, dto);
  }

  @Post('uploads/cover')
  @Version('1')
  @HttpCode(201)
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildUploadStorage('covers'),
      limits: {
        fileSize: 8 * 1024 * 1024,
      },
    }),
  )
  uploadCover(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    const validFile = ensureImageFile(file);
    const relativePath = `/uploads/covers/${validFile.filename}`;

    return {
      url: buildAbsoluteUploadUrl(request, relativePath),
      path: relativePath,
      mimeType: validFile.mimetype,
    };
  }

  @Post('uploads/editor-media')
  @Version('1')
  @HttpCode(201)
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildUploadStorage('editor-media'),
      limits: {
        fileSize: 25 * 1024 * 1024,
      },
    }),
  )
  uploadEditorMedia(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    const validFile = ensureEditorMediaFile(file);
    const relativePath = `/uploads/editor-media/${validFile.filename}`;

    return {
      url: buildAbsoluteUploadUrl(request, relativePath),
      path: relativePath,
      mimeType: validFile.mimetype,
    };
  }

  @Patch(':bookId')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  updateBook(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Body() dto: UpsertBookDto,
  ) {
    return this.booksService.updateBook(user.id, bookId, dto);
  }

  @Post(':bookId/complete')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  completeBook(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
  ) {
    return this.booksService.markBookComplete(user.id, bookId);
  }

  @Post(':bookId/offers')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  createOffer(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Body() dto: UpsertOfferDto,
  ) {
    return this.booksService.upsertOffer(user.id, bookId, dto);
  }

  @Patch(':bookId/offers/:offerId')
  @Version('1')
  @UseGuards(SessionAuthGuard)
  updateOffer(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
    @Param('offerId') offerId: string,
    @Body() dto: UpsertOfferDto,
  ) {
    return this.booksService.upsertOffer(user.id, bookId, dto, offerId);
  }
}
