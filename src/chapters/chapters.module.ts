import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BooksModule } from '../books/books.module';
import { ChaptersController } from './chapters.controller';

@Module({
  imports: [AuthModule, BooksModule],
  controllers: [ChaptersController],
})
export class ChaptersModule {}
