import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CreateCampaignDto } from './campaign.dto';
import { CampaignService } from './campaign.service';

@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Post()
  async create(@Req() request: AuthenticatedRequest, @Body() dto: CreateCampaignDto) {
    return { data: await this.campaigns.create(request.user!.id, dto.name), error: null, meta: {} };
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return { data: this.campaigns.findAllOwnedBy(request.user!.id), error: null, meta: {} };
  }

  @Get(':campaignId')
  async getCampaign(@Req() request: AuthenticatedRequest, @Param('campaignId') campaignId: string) {
    return { data: this.campaigns.findOwnedBy(campaignId, request.user!.id), error: null, meta: {} };
  }
}
