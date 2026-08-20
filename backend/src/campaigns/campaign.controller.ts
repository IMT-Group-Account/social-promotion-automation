import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { CampaignService } from './campaign.service';

interface AuthenticatedRequest { user?: { id?: string }; }
interface CreateCampaignDto { name: string; }

@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateCampaignDto) {
    return { data: this.campaigns.create(this.ownerId(request), dto.name), error: null, meta: {} };
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return { data: this.campaigns.findAllOwnedBy(this.ownerId(request)), error: null, meta: {} };
  }

  @Get(':campaignId')
  getCampaign(@Req() request: AuthenticatedRequest, @Param('campaignId') campaignId: string) {
    return { data: this.campaigns.findOwnedBy(campaignId, this.ownerId(request)), error: null, meta: {} };
  }

  private ownerId(request: AuthenticatedRequest): string {
    const ownerId = request.user?.id;
    if (!ownerId) throw new UnauthorizedException('An authenticated owner context is required.');
    return ownerId;
  }
}
