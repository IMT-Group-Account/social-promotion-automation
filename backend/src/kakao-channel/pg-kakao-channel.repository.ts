import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import type { KakaoChannelRepository } from './kakao-channel.repository';
import type { KakaoChannel, KakaoChannelFunnel, KakaoChannelInboundSource, KakaoConsultationStatus } from './kakao-channel.entity';

@Injectable()
export class PgKakaoChannelRepository implements KakaoChannelRepository {
  private pool: Pool | undefined;

  async createChannel(input: Omit<KakaoChannel, 'id' | 'status'>): Promise<KakaoChannel> {
    const result = await this.db().query<{ id: string; owner_id: string; public_id: string; name: string; consultation_url: string; status: KakaoChannel['status'] }>(
      `INSERT INTO kakao_channels (owner_id, public_id, name, consultation_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_id, public_id, name, consultation_url, status`,
      [input.ownerId, input.publicId, input.name, input.consultationUrl],
    );
    const row = result.rows[0];
    if (!row) throw new ServiceUnavailableException('Kakao Channel persistence returned no row.');
    return this.channel(row);
  }

  async findOwnedChannel(ownerId: string, channelId: string): Promise<KakaoChannel | null> {
    const result = await this.db().query<{ id: string; owner_id: string; public_id: string; name: string; consultation_url: string; status: KakaoChannel['status'] }>(
      `SELECT id, owner_id, public_id, name, consultation_url, status
       FROM kakao_channels WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
      [channelId, ownerId],
    );
    const row = result.rows[0];
    return row ? this.channel(row) : null;
  }

  async createEntry(input: { channelId: string; campaignId: string | null; source: KakaoChannelInboundSource; trackingCode: string }): Promise<void> {
    await this.db().query(
      `INSERT INTO kakao_channel_inbound_events (channel_id, campaign_id, source, tracking_code)
       VALUES ($1, $2, $3, $4)`,
      [input.channelId, input.campaignId, input.source, input.trackingCode],
    );
  }

  async openEntry(trackingCode: string): Promise<{ consultationUrl: string } | null> {
    const result = await this.db().query<{ consultation_url: string }>(
      `UPDATE kakao_channel_inbound_events AS event
       SET opened_at = COALESCE(event.opened_at, now())
       FROM kakao_channels AS channel
       WHERE event.tracking_code = $1 AND event.channel_id = channel.id AND channel.status = 'active'
       RETURNING channel.consultation_url`,
      [trackingCode],
    );
    const row = result.rows[0];
    return row ? { consultationUrl: row.consultation_url } : null;
  }

  async recordConsultation(input: { channelId: string; inboundTrackingCode: string | null; externalConversationRef: string; status: KakaoConsultationStatus }): Promise<void> {
    await this.db().query(
      `INSERT INTO kakao_channel_consultations (channel_id, inbound_event_id, external_conversation_ref, status, started_at)
       VALUES (
         $1,
         (SELECT id FROM kakao_channel_inbound_events WHERE tracking_code = $2 AND channel_id = $1),
         $3, $4, now()
       )
       ON CONFLICT (channel_id, external_conversation_ref) DO UPDATE SET
         status = EXCLUDED.status,
         resolved_at = CASE WHEN EXCLUDED.status IN ('resolved', 'closed') THEN now() ELSE kakao_channel_consultations.resolved_at END,
         updated_at = now()`,
      [input.channelId, input.inboundTrackingCode, input.externalConversationRef, input.status],
    );
  }

  async getFunnel(ownerId: string, channelId: string): Promise<KakaoChannelFunnel | null> {
    const result = await this.db().query<{ issued_entries: string; opened_entries: string; consultations_started: string; consultations_resolved: string }>(
      `SELECT
         (SELECT count(*) FROM kakao_channel_inbound_events WHERE channel_id = channel.id) AS issued_entries,
         (SELECT count(*) FROM kakao_channel_inbound_events WHERE channel_id = channel.id AND opened_at IS NOT NULL) AS opened_entries,
         (SELECT count(*) FROM kakao_channel_consultations WHERE channel_id = channel.id) AS consultations_started,
         (SELECT count(*) FROM kakao_channel_consultations WHERE channel_id = channel.id AND status IN ('resolved', 'closed')) AS consultations_resolved
       FROM kakao_channels AS channel
       WHERE channel.id = $1 AND channel.owner_id = $2 AND channel.status = 'active'`,
      [channelId, ownerId],
    );
    const row = result.rows[0];
    return row ? {
      issuedEntries: Number(row.issued_entries), openedEntries: Number(row.opened_entries),
      consultationsStarted: Number(row.consultations_started), consultationsResolved: Number(row.consultations_resolved),
    } : null;
  }

  private channel(row: { id: string; owner_id: string; public_id: string; name: string; consultation_url: string; status: KakaoChannel['status'] }): KakaoChannel {
    return { id: row.id, ownerId: row.owner_id, publicId: row.public_id, name: row.name, consultationUrl: row.consultation_url, status: row.status };
  }

  private db(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('Kakao Channel database persistence is not configured.');
    this.pool = new Pool({ connectionString, max: 3 });
    return this.pool;
  }
}
