import type { SocialPlatform } from '../posts/post.entity';

export type KakaoChannelInboundSource = SocialPlatform | 'direct';
export type KakaoConsultationStatus = 'started' | 'assigned' | 'resolved' | 'closed';

export interface KakaoChannel {
  id: string;
  ownerId: string;
  publicId: string;
  name: string;
  consultationUrl: string;
  status: 'active' | 'disabled';
}

export interface KakaoChannelEntry {
  trackingCode: string;
  channelId: string;
  campaignId: string | null;
  source: KakaoChannelInboundSource;
  entryUrl: string;
}

export interface KakaoChannelFunnel {
  issuedEntries: number;
  openedEntries: number;
  consultationsStarted: number;
  consultationsResolved: number;
}
