import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlogStatus } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../common/types/authenticated-request';
import { UpsertBlogPostDto } from './dto/blog.dto';

const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
  'img',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'pre',
  'code',
  'hr',
]);

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  '*': ['class'],
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function extractText(html: string) {
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return stripped.replace(/\s+/g, ' ').trim();
}

function estimateReadingTimeMinutes(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function buildExcerpt(text: string) {
  if (!text) return '';
  if (text.length <= 180) return text;
  return `${text.slice(0, 180).trim()}...`;
}

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublicPosts(limit = 30) {
    const posts = await this.prisma.blogPost.findMany({
      where: {
        status: BlogStatus.PUBLISHED,
        publishedAt: {
          not: null,
          lte: new Date(),
        },
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: limit,
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
    }));
  }

  async getPublicPostBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: {
        slug,
        status: BlogStatus.PUBLISHED,
        publishedAt: {
          not: null,
          lte: new Date(),
        },
      },
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Blog post not found.');
    }

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
    };
  }

  async listAdminPosts(limit = 200) {
    const posts = await this.prisma.blogPost.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
      take: limit,
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    return posts.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    }));
  }

  async getAdminPostById(postId: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Blog post not found.');
    }

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  async createPost(user: SessionUser, dto: UpsertBlogPostDto) {
    const sanitizedHtml = sanitizeHtml(dto.contentHtml, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: ALLOWED_ATTRIBUTES,
      allowedSchemes: ['http', 'https', 'mailto'],
    });
    const contentText = extractText(sanitizedHtml);

    if (!contentText) {
      throw new BadRequestException('Post content cannot be empty.');
    }

    const baseSlug = slugify(dto.slug ?? dto.title);
    const slug = await this.ensureUniqueSlug(baseSlug);
    const excerpt = dto.excerpt?.trim() || buildExcerpt(contentText);

    const status = dto.status ?? BlogStatus.DRAFT;
    const publishedAt = status === BlogStatus.PUBLISHED ? new Date() : null;

    const post = await this.prisma.blogPost.create({
      data: {
        title: dto.title.trim(),
        slug,
        excerpt,
        contentHtml: sanitizedHtml,
        contentText,
        coverImageUrl: dto.coverImageUrl?.trim() || null,
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
        tags: this.normalizeTags(dto.tags),
        status,
        publishedAt,
        readingTimeMinutes: estimateReadingTimeMinutes(contentText),
        authorId: user.id,
      },
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  async updatePost(postId: string, dto: UpsertBlogPostDto) {
    const existing = await this.prisma.blogPost.findUnique({
      where: {
        id: postId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Blog post not found.');
    }

    const sanitizedHtml = sanitizeHtml(dto.contentHtml, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: ALLOWED_ATTRIBUTES,
      allowedSchemes: ['http', 'https', 'mailto'],
    });
    const contentText = extractText(sanitizedHtml);

    if (!contentText) {
      throw new BadRequestException('Post content cannot be empty.');
    }

    const baseSlug = slugify(dto.slug ?? dto.title);
    const slug = await this.ensureUniqueSlug(baseSlug, postId);
    const excerpt = dto.excerpt?.trim() || buildExcerpt(contentText);
    const status = dto.status ?? existing.status;
    const publishedAt =
      status === BlogStatus.PUBLISHED
        ? (existing.publishedAt ?? new Date())
        : null;

    const post = await this.prisma.blogPost.update({
      where: {
        id: postId,
      },
      data: {
        title: dto.title.trim(),
        slug,
        excerpt,
        contentHtml: sanitizedHtml,
        contentText,
        coverImageUrl: dto.coverImageUrl?.trim() || null,
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
        tags: this.normalizeTags(dto.tags),
        status,
        publishedAt,
        readingTimeMinutes: estimateReadingTimeMinutes(contentText),
      },
      include: {
        author: {
          select: {
            displayName: true,
          },
        },
      },
    });

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentHtml: post.contentHtml,
      coverImageUrl: post.coverImageUrl,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      readingTimeMinutes: post.readingTimeMinutes,
      tags: post.tags,
      authorName: post.author.displayName,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  async deletePost(postId: string) {
    await this.prisma.blogPost.delete({
      where: {
        id: postId,
      },
    });

    return { success: true };
  }

  private normalizeTags(tags?: string[]) {
    if (!tags) return [];
    return tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private async ensureUniqueSlug(baseSlug: string, postId?: string) {
    if (!baseSlug) {
      throw new BadRequestException('Slug is required.');
    }

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.blogPost.findUnique({
        where: {
          slug,
        },
      });

      if (!existing || existing.id === postId) {
        return slug;
      }

      counter += 1;
      slug = `${baseSlug}-${counter}`;
    }
  }
}
