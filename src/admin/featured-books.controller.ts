import { Body, Controller, Get, Put, UseGuards, Version } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { UpdateFeaturedBooksDto } from './dto/featured-books.dto';
import { FeaturedBooksAdminService } from './featured-books.service';

@ApiTags('admin')
@Controller('admin/featured-books')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class FeaturedBooksAdminController {
  constructor(private readonly featuredBooksAdmin: FeaturedBooksAdminService) {}

  @Get()
  @Version('1')
  listFeaturedBooks() {
    return this.featuredBooksAdmin.listFeaturedBooks();
  }

  @Put()
  @Version('1')
  setFeaturedBooks(@Body() dto: UpdateFeaturedBooksDto) {
    return this.featuredBooksAdmin.setFeaturedBooks(dto.bookIds ?? []);
  }
}
