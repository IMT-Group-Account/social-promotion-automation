import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { KakaoChannel, KakaoChannelEntry, KakaoChannelFunnel, KakaoChannelInboundSource, KakaoConsultationStatus } from './kakao-channel.entity';
import { KAKAO_CHANNEL_REPOSITORY, type KakaoChannelRepository } from './kakao-channel.repository';

@Injectable()
export class KakaoChannelService {
  constructor(@Inject(KAKAO_CHANNEL_REPOSITORY) private readonly repository: KakaoChannelRepository) {}

  async createChannel(ownerId: string, input: { publicId: string; name: string; consultationUrl: string }): Promise<KakaoChannel> {
    if (!ownerId?.trim()) throw new ForbiddenException('An authenticated owner context is required.');
    const publicId = this.publicId(input.publicId);
    const name = input.name?.trim();
    if (!name || name.length > 100) throw new TypeError('Kakao Channel name must be 1-100 characters.');
    return this.repository.createChannel({ ownerId, publicId, name, consultationUrl: this.consultationUrl(input.consultationUrl) });
  }

  async createEntry(ownerId: string, input: { channelId: string; campaignId?: string; source: KakaoChannelInboundSource }): Promise<KakaoChannelEntry> {
    if (!ownerId?.trim()) throw new ForbiddenException('An authenticated owner context is required.');
    const channel = await this.repository.findOwnedChannel(ownerId, input.channelId);
    if (!channel) throw new NotFoundException('Kakao Channel not found.');
    if (!this.isSource(input.source)) throw new TypeError('Kakao Channel inbound source is invalid.');
    const trackingCode = randomUUID();
    await this.repository.createEntry({ channelId: channel.id, campaignId: input.campaignId?.trim() || null, source: input.source, trackingCode });
    return { trackingCode, channelId: channel.id, campaignId: input.campaignId?.trim() || null, source: input.source, entryUrl: this.entryUrl(trackingCode) };
  }

  async openEntry(trackingCode: string): Promise<string> {
    if (!this.uuid(trackingCode)) throw new NotFoundException('Kakao Channel entry was not found.');
    const entry = await this.repository.openEntry(trackingCode);
    if (!entry) throw new NotFoundException('Kakao Channel entry was not found.');
    return this.consultationUrl(entry.consultationUrl);
  }

  async recordConsultation(integrationKey: string | undefined, input: { channelId: string; inboundTrackingCode?: string; externalConversationRef: string; status: KakaoConsultationStatus }): Promise<void> {
    this.assertIntegrationKey(integrationKey);
    if (!this.uuid(input.channelId)) throw new TypeError('Kakao Channel ID is invalid.');
    if (input.inboundTrackingCode && !this.uuid(input.inboundTrackingCode)) throw new TypeError('Kakao inbound tracking code is invalid.');
    if (!input.externalConversationRef?.trim() || input.externalConversationRef.length > 200) throw new TypeError('External consultation reference must be 1-200 characters.');
    if (!['started', 'assigned', 'resolved', 'closed'].includes(input.status)) throw new TypeError('Kakao consultation status is invalid.');
    await this.repository.recordConsultation({
      channelId: input.channelId, inboundTrackingCode: input.inboundTrackingCode ?? null,
      externalConversationRef: input.externalConversationRef.trim(), status: input.status,
    });
  }

  async funnel(ownerId: string, channelId: string): Promise<KakaoChannelFunnel> {
    if (!ownerId?.trim()) throw new ForbiddenException('An authenticated owner context is required.');
    const funnel = await this.repository.getFunnel(ownerId, channelId);
    if (!funnel) throw new NotFoundException('Kakao Channel not found.');
    return funnel;
  }

  private entryUrl(trackingCode: string): string {
    const origin = process.env.PUBLIC_API_ORIGIN;
    if (!origin) throw new ServiceUnavailableException('PUBLIC_API_ORIGIN is not configured.');
    try { return new URL(`/api/kakao-channel/entry/${trackingCode}`, origin).toString(); }
    catch { throw new ServiceUnavailableException('PUBLIC_API_ORIGIN must be a valid URL.'); }
  }

  private consultationUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new TypeError('Kakao consultation URL is invalid.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'pf.kakao.com' || !url.pathname.endsWith('/chat')) {
      throw new TypeError('Kakao consultation URL must be an HTTPS pf.kakao.com channel chat URL.');
    }
    return url.toString();
  }

  private publicId(value: string): string {
    if (!/^[_A-Za-z0-9-]{1,100}$/.test(value ?? '')) throw new TypeError('Kakao Channel public ID is invalid.');
    return value;
  }
  private isSource(value: string): value is KakaoChannelInboundSource { return ['linkedin', 'facebook', 'instagram', 'threads', 'x', 'direct'].includes(value); }
  private uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

  private assertIntegrationKey(actual: string | undefined): void {
    const expected = process.env.KAKAO_CHANNEL_INTEGRATION_KEY;
    if (!expected) throw new ServiceUnavailableException('KAKAO_CHANNEL_INTEGRATION_KEY is not configured.');
    const supplied = actual ?? '';
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      throw new ForbiddenException('Kakao Channel integration authentication failed.');
    }
  }
}
