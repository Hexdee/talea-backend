import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BlogController],
  providers: [BlogService],
})
export class BlogModule {}
