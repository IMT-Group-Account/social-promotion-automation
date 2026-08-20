import type { KakaoChannel, KakaoChannelFunnel, KakaoChannelInboundSource, KakaoConsultationStatus } from './kakao-channel.entity';

export const KAKAO_CHANNEL_REPOSITORY = Symbol('KAKAO_CHANNEL_REPOSITORY');

export interface KakaoChannelRepository {
  createChannel(input: Omit<KakaoChannel, 'id' | 'status'>): Promise<KakaoChannel>;
  findOwnedChannel(ownerId: string, channelId: string): Promise<KakaoChannel | null>;
  createEntry(input: { channelId: string; campaignId: string | null; source: KakaoChannelInboundSource; trackingCode: string }): Promise<void>;
  openEntry(trackingCode: string): Promise<{ consultationUrl: string } | null>;
  recordConsultation(input: { channelId: string; inboundTrackingCode: string | null; externalConversationRef: string; status: KakaoConsultationStatus }): Promise<void>;
  getFunnel(ownerId: string, channelId: string): Promise<KakaoChannelFunnel | null>;
}
