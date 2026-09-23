import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('campaigns/:campaignId/dashboard')
  async dashboard(@Req() request: AuthenticatedRequest, @Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return { data: await this.analytics.campaignDashboard(request.user!.id, campaignId), error: null, meta: {} };
  }

  @Get('campaigns/:campaignId/raw')
  rawMetrics(
    @Req() request: AuthenticatedRequest,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query('platform') platform?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.analytics.campaignRawMetrics(request.user!.id, campaignId, { platform, limit, cursor })
      .then((data) => ({ data, error: null, meta: {} }));
  }
}
