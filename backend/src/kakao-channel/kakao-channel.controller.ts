import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { PublicRoute } from '../auth/public-route.decorator';
import { CreateKakaoChannelDto, CreateKakaoChannelEntryDto, KakaoConsultationEventDto } from './kakao-channel.dto';
import { KakaoChannelService } from './kakao-channel.service';

interface RedirectResponse { redirect(url: string): void; }

@Controller('kakao-channel')
export class KakaoChannelController {
  constructor(private readonly channels: KakaoChannelService) {}

  @Post('channels')
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateKakaoChannelDto) {
    return { data: await this.channels.createChannel(request.user!.id, input), error: null, meta: {} };
  }

  @Post('entries')
  async createEntry(@Req() request: AuthenticatedRequest, @Body() input: CreateKakaoChannelEntryDto) {
    return { data: await this.channels.createEntry(request.user!.id, input), error: null, meta: {} };
  }

  @Get('entry/:trackingCode')
  @PublicRoute()
  async openEntry(@Param('trackingCode') trackingCode: string, @Res() response: RedirectResponse): Promise<void> {
    response.redirect(await this.channels.openEntry(trackingCode));
  }

  @Post('consultations/events')
  @PublicRoute()
  async consultationEvent(
    @Headers('x-kakao-channel-integration-key') integrationKey: string | undefined,
    @Body() input: KakaoConsultationEventDto,
  ) {
    await this.channels.recordConsultation(integrationKey, input);
    return { data: { accepted: true }, error: null, meta: {} };
  }

  @Get('channels/:channelId/funnel')
  async funnel(@Req() request: AuthenticatedRequest, @Param('channelId') channelId: string) {
    return { data: await this.channels.funnel(request.user!.id, channelId), error: null, meta: {} };
  }
}
