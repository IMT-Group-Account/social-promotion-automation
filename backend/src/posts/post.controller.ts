import { Body, Controller, Get, Param, Post as HttpPost, Req } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CampaignService } from '../campaigns/campaign.service';
import { CreatePostDto, SchedulePostDto } from './post.dto';
import { PostService } from './post.service';

@Controller('posts')
export class PostController {
  constructor(
    private readonly posts: PostService,
    private readonly campaigns: CampaignService,
    private readonly analytics: AnalyticsService,
  ) {}

  @HttpPost()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePostDto) {
    const ownerId = request.user!.id;
    this.campaigns.findOwnedBy(dto.campaignId, ownerId);
    return { data: this.posts.create(ownerId, dto), error: null, meta: {} };
  }

  @Get(':postId')
  getOne(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: this.posts.findOwned(postId, request.user!.id), error: null, meta: {} };
  }

  @HttpPost(':postId/publish')
  publish(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: this.posts.publishNow(request.user!.id, postId), error: null, meta: { dispatch: 'queued' } };
  }

  @HttpPost(':postId/schedule')
  schedule(@Req() request: AuthenticatedRequest, @Param('postId') postId: string, @Body() dto: SchedulePostDto) {
    return { data: this.posts.schedule(request.user!.id, postId, dto.scheduledAt), error: null, meta: { dispatch: 'queued' } };
  }

  @Get(':postId/results')
  results(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    const result = this.posts.findOwned(postId, request.user!.id);
    return { data: { postId: result.post.id, status: this.posts.summarizeStatus(result.jobs), jobs: result.jobs }, error: null, meta: {} };
  }

  @Get(':postId/analytics')
  async postAnalytics(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: await this.analytics.postDashboard(request.user!.id, postId), error: null, meta: {} };
  }
}
