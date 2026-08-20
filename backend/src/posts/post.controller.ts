import { Body, Controller, Get, Param, Post as HttpPost, Req, UnauthorizedException } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { CampaignService } from '../campaigns/campaign.service';
import { type CreatePostDto } from './post.dto';
import { PostService } from './post.service';

interface AuthenticatedRequest { user?: { id?: string }; }
interface SchedulePostDto { scheduledAt: string; }

@Controller('posts')
export class PostController {
  constructor(
    private readonly posts: PostService,
    private readonly campaigns: CampaignService,
    private readonly analytics: AnalyticsService,
  ) {}

  @HttpPost()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePostDto) {
    const ownerId = this.ownerId(request);
    this.campaigns.findOwnedBy(dto.campaignId, ownerId);
    return { data: this.posts.create(ownerId, dto), error: null, meta: {} };
  }

  @Get(':postId')
  getOne(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: this.posts.findOwned(postId, this.ownerId(request)), error: null, meta: {} };
  }

  @HttpPost(':postId/publish')
  publish(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: this.posts.publishNow(this.ownerId(request), postId), error: null, meta: { dispatch: 'queued' } };
  }

  @HttpPost(':postId/schedule')
  schedule(@Req() request: AuthenticatedRequest, @Param('postId') postId: string, @Body() dto: SchedulePostDto) {
    return { data: this.posts.schedule(this.ownerId(request), postId, dto.scheduledAt), error: null, meta: { dispatch: 'queued' } };
  }

  @Get(':postId/results')
  results(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    const result = this.posts.findOwned(postId, this.ownerId(request));
    return { data: { postId: result.post.id, status: this.posts.summarizeStatus(result.jobs), jobs: result.jobs }, error: null, meta: {} };
  }

  @Get(':postId/analytics')
  async postAnalytics(@Req() request: AuthenticatedRequest, @Param('postId') postId: string) {
    return { data: await this.analytics.postDashboard(this.ownerId(request), postId), error: null, meta: {} };
  }

  private ownerId(request: AuthenticatedRequest): string {
    const ownerId = request.user?.id;
    if (!ownerId) throw new UnauthorizedException('An authenticated owner context is required.');
    return ownerId;
  }
}
