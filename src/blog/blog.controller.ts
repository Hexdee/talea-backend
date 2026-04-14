import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { BlogService } from './blog.service';
import { BlogPostListQueryDto, UpsertBlogPostDto } from './dto/blog.dto';

@ApiTags('blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('posts')
  @Version('1')
  listPublicPosts(@Query() query: BlogPostListQueryDto) {
    return this.blogService.listPublicPosts(query.limit ?? 30);
  }

  @Get('posts/:slug')
  @Version('1')
  getPublicPost(@Param('slug') slug: string) {
    return this.blogService.getPublicPostBySlug(slug);
  }

  @Get('admin/posts')
  @Version('1')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  listAdminPosts() {
    return this.blogService.listAdminPosts();
  }

  @Get('admin/posts/:postId')
  @Version('1')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  getAdminPost(@Param('postId') postId: string) {
    return this.blogService.getAdminPostById(postId);
  }

  @Post('posts')
  @Version('1')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  createPost(@CurrentUser() user: SessionUser, @Body() dto: UpsertBlogPostDto) {
    return this.blogService.createPost(user, dto);
  }

  @Patch('posts/:postId')
  @Version('1')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  updatePost(@Param('postId') postId: string, @Body() dto: UpsertBlogPostDto) {
    return this.blogService.updatePost(postId, dto);
  }

  @Delete('posts/:postId')
  @Version('1')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  deletePost(@Param('postId') postId: string) {
    return this.blogService.deletePost(postId);
  }
}
