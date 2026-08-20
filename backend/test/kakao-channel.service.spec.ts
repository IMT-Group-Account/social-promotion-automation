import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { KakaoChannelService } from '../src/kakao-channel/kakao-channel.service';
import type { KakaoChannel, KakaoChannelFunnel, KakaoChannelInboundSource, KakaoConsultationStatus } from '../src/kakao-channel/kakao-channel.entity';
import type { KakaoChannelRepository } from '../src/kakao-channel/kakao-channel.repository';

process.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
process.env.KAKAO_CHANNEL_INTEGRATION_KEY = 'test-kakao-bridge-key';

const channelId = '8c5912f3-41c5-4daf-b6cb-7616c8140bcb';

class MemoryKakaoChannelRepository implements KakaoChannelRepository {
  readonly channels = new Map<string, KakaoChannel>();
  readonly entries = new Map<string, { channelId: string; campaignId: string | null; source: KakaoChannelInboundSource; opened: boolean }>();
  readonly consultations = new Map<string, KakaoConsultationStatus>();

  async createChannel(input: Omit<KakaoChannel, 'id' | 'status'>): Promise<KakaoChannel> {
    const channel: KakaoChannel = { id: channelId, ...input, status: 'active' };
    this.channels.set(channel.id, channel);
    return channel;
  }
  async findOwnedChannel(ownerId: string, id: string): Promise<KakaoChannel | null> {
    const channel = this.channels.get(id);
    return channel?.ownerId === ownerId && channel.status === 'active' ? channel : null;
  }
  async createEntry(input: { channelId: string; campaignId: string | null; source: KakaoChannelInboundSource; trackingCode: string }): Promise<void> {
    this.entries.set(input.trackingCode, { channelId: input.channelId, campaignId: input.campaignId, source: input.source, opened: false });
  }
  async openEntry(trackingCode: string): Promise<{ consultationUrl: string } | null> {
    const entry = this.entries.get(trackingCode);
    if (!entry) return null;
    const channel = this.channels.get(entry.channelId);
    if (!channel) return null;
    entry.opened = true;
    return { consultationUrl: channel.consultationUrl };
  }
  async recordConsultation(input: { channelId: string; inboundTrackingCode: string | null; externalConversationRef: string; status: KakaoConsultationStatus }): Promise<void> {
    this.consultations.set(`${input.channelId}:${input.externalConversationRef}`, input.status);
  }
  async getFunnel(ownerId: string, id: string): Promise<KakaoChannelFunnel | null> {
    const channel = await this.findOwnedChannel(ownerId, id);
    if (!channel) return null;
    const entries = [...this.entries.values()].filter((entry) => entry.channelId === id);
    const consultationStatuses = [...this.consultations.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([, status]) => status);
    return {
      issuedEntries: entries.length,
      openedEntries: entries.filter((entry) => entry.opened).length,
      consultationsStarted: consultationStatuses.length,
      consultationsResolved: consultationStatuses.filter((status) => status === 'resolved' || status === 'closed').length,
    };
  }
}

test('tracks a campaign entry then redirects only to the registered Kakao Channel chat URL', async () => {
  const repository = new MemoryKakaoChannelRepository();
  const service = new KakaoChannelService(repository);
  const channel = await service.createChannel('owner-001', {
    publicId: '_campaign', name: 'Campaign Foundation', consultationUrl: 'https://pf.kakao.com/_campaign/chat',
  });
  const entry = await service.createEntry('owner-001', { channelId: channel.id, campaignId: 'campaign-001', source: 'instagram' });
  assert.match(entry.entryUrl, /^https:\/\/api\.example\.com\/api\/kakao-channel\/entry\//);
  assert.equal(await service.openEntry(entry.trackingCode), 'https://pf.kakao.com/_campaign/chat');
  assert.deepEqual(await service.funnel('owner-001', channel.id), {
    issuedEntries: 1, openedEntries: 1, consultationsStarted: 0, consultationsResolved: 0,
  });
});

test('records only opaque consultation lifecycle data through the protected integration bridge', async () => {
  const repository = new MemoryKakaoChannelRepository();
  const service = new KakaoChannelService(repository);
  const channel = await service.createChannel('owner-001', {
    publicId: '_campaign', name: 'Campaign Foundation', consultationUrl: 'https://pf.kakao.com/_campaign/chat',
  });
  await service.recordConsultation('test-kakao-bridge-key', {
    channelId: channel.id, externalConversationRef: 'bridge-conversation-opaque-001', status: 'resolved',
  });
  assert.deepEqual(await service.funnel('owner-001', channel.id), {
    issuedEntries: 0, openedEntries: 0, consultationsStarted: 1, consultationsResolved: 1,
  });
  await assert.rejects(() => service.recordConsultation('incorrect', {
    channelId: channel.id, externalConversationRef: 'bridge-conversation-opaque-002', status: 'started',
  }), ForbiddenException);
});

test('rejects arbitrary redirects rather than allowing a user supplied consultation destination', async () => {
  const service = new KakaoChannelService(new MemoryKakaoChannelRepository());
  await assert.rejects(() => service.createChannel('owner-001', {
    publicId: '_campaign', name: 'Campaign Foundation', consultationUrl: 'https://example.com/phishing',
  }), /pf\.kakao\.com/);
});
