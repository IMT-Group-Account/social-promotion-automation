import { ForbiddenException, Inject, Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { INSTAGRAM_CREDENTIAL_RESOLVER, type InstagramCredentialResolver, type InstagramPublishingCredential } from './instagram-credential.service';
import { INSTAGRAM_HTTP_CLIENT, type InstagramHttpClient } from './instagram-http.client';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from './social-adapter.interface';

@Injectable()
export class InstagramAdapter implements SocialAdapter {
  readonly platform = 'instagram' as const;

  constructor(
    @Inject(INSTAGRAM_CREDENTIAL_RESOLVER) private readonly credentials: InstagramCredentialResolver,
    @Inject(INSTAGRAM_HTTP_CLIENT) private readonly http: InstagramHttpClient,
  ) {}

  async publish(post: SocialPost): Promise<PublishResult> {
    if (post.platform !== 'instagram') throw new TypeError('Instagram adapter can publish only Instagram posts.');
    if (post.media.length !== 1) throw new NotImplementedException('Instagram publishing requires exactly one image or video until carousel publishing is implemented.');
    const media = post.media[0];
    const container = await this.createContainer({ socialAccountId: post.socialAccountId, mediaType: media.type, mediaUrl: media.url, caption: post.body });
    await this.waitUntilReady(post.socialAccountId, container.id);
    return this.publishContainer(post.socialAccountId, container.id);
  }

  async createContainer(input: { socialAccountId: string; mediaType: 'image' | 'video'; mediaUrl: string; caption: string }): Promise<{ id: string }> {
    const credential = await this.writeCredential(input.socialAccountId);
    const parameters = input.mediaType === 'image'
      ? { image_url: this.https(input.mediaUrl), ...(input.caption ? { caption: input.caption } : {}) }
      : { media_type: 'REELS', video_url: this.https(input.mediaUrl), ...(input.caption ? { caption: input.caption } : {}) };
    const response = await this.http.request({ method: 'POST', url: this.edgeUrl(credential.instagramAccountId, 'media'), accessToken: credential.accessToken, parameters });
    const id = this.string(this.object(response.body).id);
    if (!id) throw new ServiceUnavailableException('Instagram did not return a media container ID.');
    return { id };
  }

  async waitUntilReady(socialAccountId: string, containerId: string): Promise<void> {
    const credential = await this.writeCredential(socialAccountId);
    const attempts = this.positiveIntegerEnv('INSTAGRAM_CONTAINER_MAX_ATTEMPTS', 30);
    const intervalMs = this.positiveIntegerEnv('INSTAGRAM_CONTAINER_POLL_INTERVAL_MS', 5_000);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await this.http.request({ method: 'GET', url: this.objectUrl(containerId), accessToken: credential.accessToken, parameters: { fields: 'status_code,status' } });
      const payload = this.object(response.body);
      const status = this.string(payload.status_code) ?? this.string(payload.status);
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') throw new ServiceUnavailableException(`Instagram media container entered ${status}.`);
      if (attempt < attempts - 1) await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new ServiceUnavailableException('Instagram media container did not become ready before timeout.');
  }

  async publishContainer(socialAccountId: string, containerId: string): Promise<PublishResult> {
    const credential = await this.writeCredential(socialAccountId);
    const response = await this.http.request({ method: 'POST', url: this.edgeUrl(credential.instagramAccountId, 'media_publish'), accessToken: credential.accessToken, parameters: { creation_id: containerId } });
    const remotePostId = this.string(this.object(response.body).id);
    if (!remotePostId) throw new ServiceUnavailableException('Instagram did not return a published media ID.');
    return { remotePostId, publishedAt: new Date() };
  }

  async getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult> {
    const credential = await this.readCredential(socialAccountId);
    const response = await this.http.request({ method: 'GET', url: this.objectUrl(postId), accessToken: credential.accessToken, parameters: { fields: 'id,permalink,media_type' } });
    const payload = this.object(response.body);
    return { remotePostId: this.string(payload.id) ?? postId, remotePostUrl: this.string(payload.permalink) ?? undefined, status: 'published' };
  }

  async getAnalytics(postId: string, socialAccountId?: string): Promise<PostAnalytics> {
    const credential = await this.readCredential(socialAccountId);
    const template = process.env.INSTAGRAM_ANALYTICS_URL;
    if (!template) throw new NotImplementedException('INSTAGRAM_ANALYTICS_URL configuration is required.');
    const response = await this.http.request({ method: 'GET', url: template.replace('{postId}', encodeURIComponent(postId)), accessToken: credential.accessToken });
    const payload = this.object(response.body);
    const views = this.number(payload.views ?? payload.impressions ?? payload.reach);
    if (views === null) throw new ServiceUnavailableException('Instagram analytics response lacks view metrics.');
    return {
      views, likes: this.number(payload.likes) ?? 0, comments: this.number(payload.comments) ?? 0,
      shares: this.number(payload.shares) ?? 0, clicks: this.number(payload.clicks) ?? 0, capturedAt: new Date(),
    };
  }

  private async writeCredential(socialAccountId: string): Promise<InstagramPublishingCredential> { const credential = await this.resolve(socialAccountId); this.requireScope(credential, 'instagram_content_publish'); return credential; }
  private async readCredential(socialAccountId: string | undefined): Promise<InstagramPublishingCredential> { const credential = await this.resolve(socialAccountId); this.requireScope(credential, 'instagram_basic'); return credential; }
  private async resolve(socialAccountId: string | undefined): Promise<InstagramPublishingCredential> { if (!socialAccountId) throw new ForbiddenException('Instagram account context is required.'); return this.credentials.resolve(socialAccountId); }
  private requireScope(credential: InstagramPublishingCredential, scope: string): void { if (!credential.scope.has(scope)) throw new ForbiddenException(`Instagram account is missing required scope: ${scope}.`); }
  private baseUrl(): string { const value = process.env.INSTAGRAM_GRAPH_API_BASE_URL; if (!value) throw new ServiceUnavailableException('INSTAGRAM_GRAPH_API_BASE_URL is not configured.'); const url = new URL(value); if (url.protocol !== 'https:') throw new ServiceUnavailableException('INSTAGRAM_GRAPH_API_BASE_URL must use HTTPS.'); return url.toString().replace(/\/$/, ''); }
  private edgeUrl(id: string, edge: string): string { return `${this.baseUrl()}/${encodeURIComponent(id)}/${edge}`; }
  private objectUrl(id: string): string { return `${this.baseUrl()}/${encodeURIComponent(id)}`; }
  private https(value: string): string { const url = new URL(value); if (url.protocol !== 'https:') throw new TypeError('Instagram media URLs must use HTTPS.'); return url.toString(); }
  private object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('Instagram Graph API returned an invalid JSON response.'); return value as Record<string, unknown>; }
  private string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
  private number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  private positiveIntegerEnv(name: string, fallback: number): number { const raw = process.env[name]; if (!raw) return fallback; const value = Number(raw); if (!Number.isInteger(value) || value <= 0 || value > 120) throw new ServiceUnavailableException(`${name} must be a positive integer no greater than 120.`); return value; }
}
