import { Controller, Get, Param, Req, UnauthorizedException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { type SocialPlatform } from '../posts/post.entity';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('campaigns/:campaignId/dashboard')
  dashboard(@Req() request: { user?: { id?: string } }, @Param('campaignId') campaignId: string) {
    const ownerId = request.user?.id;
    if (!ownerId) throw new UnauthorizedException('An authenticated owner context is required.');
    return this.analytics.campaignDashboard(ownerId, campaignId);
  }

  @Get(':platform/:postId')
  get(@Param('platform') platform: SocialPlatform, @Param('postId') postId: string) {
    return this.analytics.getPostAnalytics(platform, postId);
  }
}
