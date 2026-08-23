import { Controller, Get, Param, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AnalyticsService } from './analytics.service';
import { type SocialPlatform } from '../posts/post.entity';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('campaigns/:campaignId/dashboard')
  dashboard(@Req() request: AuthenticatedRequest, @Param('campaignId') campaignId: string) {
    return this.analytics.campaignDashboard(request.user!.id, campaignId);
  }

  @Get(':platform/:socialAccountId/:remotePostId')
  get(
    @Param('platform') platform: SocialPlatform,
    @Param('socialAccountId') socialAccountId: string,
    @Param('remotePostId') remotePostId: string,
  ) {
    return this.analytics.getPostAnalytics(platform, remotePostId, socialAccountId);
  }
}
