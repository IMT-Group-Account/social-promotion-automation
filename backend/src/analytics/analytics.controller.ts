import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('campaigns/:campaignId/dashboard')
  dashboard(@Req() request: AuthenticatedRequest, @Param('campaignId') campaignId: string) {
    return this.analytics.campaignDashboard(request.user!.id, campaignId);
  }

  @Get('campaigns/:campaignId/raw')
  rawMetrics(
    @Req() request: AuthenticatedRequest,
    @Param('campaignId') campaignId: string,
    @Query('platform') platform?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.analytics.campaignRawMetrics(request.user!.id, campaignId, { platform, limit, cursor });
  }
}
