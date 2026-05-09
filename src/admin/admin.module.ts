import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturedBooksAdminController } from './featured-books.controller';
import { FeaturedBooksAdminService } from './featured-books.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FeaturedBooksAdminController],
  providers: [FeaturedBooksAdminService],
})
export class AdminModule {}
