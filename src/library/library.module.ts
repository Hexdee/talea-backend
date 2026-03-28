import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BooksModule } from '../books/books.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  imports: [AuthModule, BooksModule],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
