import { ForbiddenException, Inject, Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { FACEBOOK_CREDENTIAL_RESOLVER, type FacebookCredentialResolver, type FacebookPageCredential } from './facebook-credential.service';
import { FACEBOOK_HTTP_CLIENT, type FacebookHttpClient } from './facebook-http.client';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from './social-adapter.interface';

@Injectable()
export class FacebookAdapter implements SocialAdapter {
  readonly platform = 'facebook' as const;

  constructor(
    @Inject(FACEBOOK_CREDENTIAL_RESOLVER) private readonly credentials: FacebookCredentialResolver,
    @Inject(FACEBOOK_HTTP_CLIENT) private readonly http: FacebookHttpClient,
  ) {}

  async publish(post: SocialPost): Promise<PublishResult> {
    if (post.platform !== 'facebook') throw new TypeError('Facebook adapter can publish only Facebook posts.');
    const media = post.media.length === 0 ? undefined : post.media[0];
    const mediaType: 'text' | 'image' | 'video' = media ? media.type : 'text';
    switch (mediaType) {
      case 'text': return this.publishText({ socialAccountId: post.socialAccountId, message: post.body, link: post.destinationUrl ?? undefined });
      case 'image':
        if (!media) throw new TypeError('Facebook image media is missing.');
        if (post.media.length !== 1) throw new NotImplementedException('Facebook multi-image publishing needs an album workflow.');
        return this.publishImage({ socialAccountId: post.socialAccountId, imageUrl: media.url, caption: post.body });
      case 'video':
        if (!media) throw new TypeError('Facebook video media is missing.');
        if (post.media.length !== 1) throw new NotImplementedException('Facebook multi-video publishing needs a separate workflow.');
        return this.publishVideo({ socialAccountId: post.socialAccountId, videoUrl: media.url, description: post.body });
    }
  }

  publishText(input: { socialAccountId: string; message: string; link?: string }): Promise<PublishResult> {
    if (!input.message.trim() && !input.link) throw new TypeError('Facebook Page feed requires a message or link.');
    return this.create(input.socialAccountId, 'feed', { ...(input.message ? { message: input.message } : {}), ...(input.link ? { link: this.https(input.link) } : {}) });
  }

  publishImage(input: { socialAccountId: string; imageUrl: string; caption: string }): Promise<PublishResult> {
    return this.create(input.socialAccountId, 'photos', { url: this.https(input.imageUrl), ...(input.caption ? { caption: input.caption } : {}) });
  }

  publishVideo(input: { socialAccountId: string; videoUrl: string; description: string }): Promise<PublishResult> {
    // The Graph Video API may require resumable upload for large files. This route
    // accepts only a server-approved public HTTPS file URL; binary upload is separate.
    return this.create(input.socialAccountId, 'videos', { file_url: this.https(input.videoUrl), ...(input.description ? { description: input.description } : {}) });
  }

  async getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult> {
    const credential = await this.readCredential(socialAccountId);
    const response = await this.http.request({ method: 'GET', url: this.objectUrl(postId), accessToken: credential.accessToken, parameters: { fields: 'id,permalink_url,is_published' } });
    const payload = this.object(response.body);
    return { remotePostId: this.string(payload.id) ?? postId, remotePostUrl: this.string(payload.permalink_url) ?? undefined, status: payload.is_published === false ? 'unknown' : 'published' };
  }

  async deletePost(postId: string, socialAccountId?: string): Promise<void> {
    const credential = await this.writeCredential(socialAccountId);
    await this.http.request({ method: 'DELETE', url: this.objectUrl(postId), accessToken: credential.accessToken });
  }

  async getAnalytics(postId: string, socialAccountId?: string): Promise<PostAnalytics> { return this.getStatistics(postId, socialAccountId); }

  async getStatistics(postId: string, socialAccountId?: string): Promise<PostAnalytics> {
    const credential = await this.readCredential(socialAccountId);
    const template = process.env.FACEBOOK_ANALYTICS_URL;
    if (!template) throw new NotImplementedException('FACEBOOK_ANALYTICS_URL configuration is required.');
    const response = await this.http.request({ method: 'GET', url: template.replace('{postId}', encodeURIComponent(postId)), accessToken: credential.accessToken });
    const payload = this.object(response.body);
    const views = this.number(payload.views ?? payload.impressions ?? payload.impression_count ?? payload.reach);
    if (views === null) throw new ServiceUnavailableException('Facebook analytics response lacks view metrics.');
    return {
      views, likes: this.number(payload.likes ?? payload.reactions ?? payload.reaction_count) ?? 0,
      comments: this.number(payload.comments ?? payload.comment_count) ?? 0,
      shares: this.number(payload.shares ?? payload.share_count) ?? 0,
      clicks: this.number(payload.clicks ?? payload.click_count) ?? 0, capturedAt: new Date(),
    };
  }

  private async create(socialAccountId: string, edge: 'feed' | 'photos' | 'videos', parameters: Readonly<Record<string, string>>): Promise<PublishResult> {
    const credential = await this.writeCredential(socialAccountId);
    const response = await this.http.request({ method: 'POST', url: this.pageEdgeUrl(credential.pageId, edge), accessToken: credential.accessToken, parameters });
    const payload = this.object(response.body);
    const remotePostId = this.string(payload.post_id) ?? this.string(payload.id);
    if (!remotePostId) throw new ServiceUnavailableException('Meta Graph API did not return a post or media ID.');
    return { remotePostId, remotePostUrl: this.string(payload.permalink_url) ?? undefined, publishedAt: new Date() };
  }

  private async writeCredential(socialAccountId: string | undefined): Promise<FacebookPageCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, 'pages_manage_posts');
    return credential;
  }

  private async readCredential(socialAccountId: string | undefined): Promise<FacebookPageCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, 'pages_read_engagement');
    return credential;
  }

  private async resolve(socialAccountId: string | undefined): Promise<FacebookPageCredential> {
    if (!socialAccountId) throw new ForbiddenException('Facebook Page account context is required.');
    return this.credentials.resolve(socialAccountId);
  }
  private requireScope(credential: FacebookPageCredential, scope: string): void { if (!credential.scope.has(scope)) throw new ForbiddenException(`Facebook Page is missing required scope: ${scope}.`); }
  private baseUrl(): string {
    const value = process.env.FACEBOOK_GRAPH_API_BASE_URL;
    if (!value) throw new ServiceUnavailableException('FACEBOOK_GRAPH_API_BASE_URL is not configured.');
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new ServiceUnavailableException('FACEBOOK_GRAPH_API_BASE_URL must use HTTPS.');
    return url.toString().replace(/\/$/, '');
  }
  private pageEdgeUrl(pageId: string, edge: string): string { return `${this.baseUrl()}/${encodeURIComponent(pageId)}/${edge}`; }
  private objectUrl(id: string): string { return `${this.baseUrl()}/${encodeURIComponent(id)}`; }
  private https(value: string): string { const url = new URL(value); if (url.protocol !== 'https:') throw new TypeError('Facebook media and links must use HTTPS.'); return url.toString(); }
  private object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('Meta Graph API returned an invalid JSON response.'); return value as Record<string, unknown>; }
  private string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
  private number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
}
