import { Body, Controller, Get, Headers, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { KakaoChannelInboundSource, KakaoConsultationStatus } from './kakao-channel.entity';
import { KakaoChannelService } from './kakao-channel.service';

interface AuthenticatedRequest { user?: { id?: string }; }
interface RedirectResponse { redirect(url: string): void; }

@Controller('kakao-channel')
export class KakaoChannelController {
  constructor(private readonly channels: KakaoChannelService) {}

  @Post('channels')
  async create(@Req() request: AuthenticatedRequest, @Body() input: { publicId: string; name: string; consultationUrl: string }) {
    return { data: await this.channels.createChannel(this.ownerId(request), input), error: null, meta: {} };
  }

  @Post('entries')
  async createEntry(@Req() request: AuthenticatedRequest, @Body() input: { channelId: string; campaignId?: string; source: KakaoChannelInboundSource }) {
    return { data: await this.channels.createEntry(this.ownerId(request), input), error: null, meta: {} };
  }

  @Get('entry/:trackingCode')
  async openEntry(@Param('trackingCode') trackingCode: string, @Res() response: RedirectResponse): Promise<void> {
    response.redirect(await this.channels.openEntry(trackingCode));
  }

  @Post('consultations/events')
  async consultationEvent(
    @Headers('x-kakao-channel-integration-key') integrationKey: string | undefined,
    @Body() input: { channelId: string; inboundTrackingCode?: string; externalConversationRef: string; status: KakaoConsultationStatus },
  ) {
    await this.channels.recordConsultation(integrationKey, input);
    return { data: { accepted: true }, error: null, meta: {} };
  }

  @Get('channels/:channelId/funnel')
  async funnel(@Req() request: AuthenticatedRequest, @Param('channelId') channelId: string) {
    return { data: await this.channels.funnel(this.ownerId(request), channelId), error: null, meta: {} };
  }

  private ownerId(request: AuthenticatedRequest): string {
    const ownerId = request.user?.id;
    if (!ownerId) throw new UnauthorizedException('An authenticated owner context is required.');
    return ownerId;
  }
}
