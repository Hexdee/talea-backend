import { Controller, Get, Param, UseGuards, Version } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(SessionAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Version('1')
  getOverview(@CurrentUser() user: SessionUser) {
    return this.analyticsService.getOverview(user.id);
  }

  @Get('books/:bookId')
  @Version('1')
  getBookAnalytics(
    @CurrentUser() user: SessionUser,
    @Param('bookId') bookId: string,
  ) {
    return this.analyticsService.getBookAnalytics(user.id, bookId);
  }
}
