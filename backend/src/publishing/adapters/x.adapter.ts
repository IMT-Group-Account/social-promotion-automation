import { ForbiddenException, Inject, Injectable, Logger, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { XApiCostService, X_USAGE_LEDGER, type XUsageLedger, type XUsageOperation } from '../x-api-usage.service';
import { X_CREDENTIAL_RESOLVER, type XCredentialResolver, type XPublishingCredential } from './x-credential.service';
import { X_HTTP_CLIENT, type XHttpClient } from './x-http.client';
import { X_MEDIA_SOURCE, type XMediaSource } from './x-media-source.service';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from './social-adapter.interface';

@Injectable()
export class XAdapter implements SocialAdapter {
  readonly platform = 'x' as const;
  private readonly logger = new Logger(XAdapter.name);

  constructor(
    @Inject(X_CREDENTIAL_RESOLVER) private readonly credentials: XCredentialResolver,
    @Inject(X_HTTP_CLIENT) private readonly http: XHttpClient,
    @Inject(X_MEDIA_SOURCE) private readonly mediaSource: XMediaSource,
    @Inject(X_USAGE_LEDGER) private readonly usage: XUsageLedger,
    private readonly costs: XApiCostService,
  ) {}

  async publish(post: SocialPost): Promise<PublishResult> {
    if (post.platform !== 'x') throw new TypeError('X adapter can publish only X posts.');
    const text = this.postText(post);
    if (post.media.length === 0) return this.publishText({ socialAccountId: post.socialAccountId, text });
    return this.publishMedia({ socialAccountId: post.socialAccountId, text, media: post.media });
  }

  async uploadMedia(input: { socialAccountId: string; media: { type: 'image' | 'video'; url: string } }): Promise<string> {
    const credential = await this.writeCredential(input.socialAccountId);
    const source = await this.mediaSource.read(input.media);
    const response = await this.billed(credential, 'media_upload', () => this.http.request({
      method: 'POST', url: this.mediaUploadUrl(), accessToken: credential.accessToken,
      body: { media: source.base64, media_category: input.media.type === 'image' ? 'tweet_image' : 'tweet_video' },
    }));
    const id = this.string(this.data(response.body).id);
    if (!id) throw new ServiceUnavailableException('X Media Upload did not return a media ID.');
    return id;
  }

  async publishText(input: { socialAccountId: string; text: string }): Promise<PublishResult> {
    if (!input.text.trim()) throw new TypeError('X post text is required when no media is attached.');
    return this.createPost(input.socialAccountId, input.text, []);
  }

  async publishMedia(input: { socialAccountId: string; text: string; media: readonly { type: 'image' | 'video'; url: string }[] }): Promise<PublishResult> {
    if (input.media.length === 0) throw new TypeError('X media publishing requires at least one media item.');
    if (input.media.length > 4) throw new NotImplementedException('X publishing supports at most four attached media items in this adapter.');
    const mediaIds = await Promise.all(input.media.map((media) => this.uploadMedia({ socialAccountId: input.socialAccountId, media })));
    return this.createPost(input.socialAccountId, input.text, mediaIds);
  }

  async deletePost(postId: string, socialAccountId?: string): Promise<void> {
    const credential = await this.writeCredential(socialAccountId);
    const response = await this.billed(credential, 'post_delete', () => this.http.request({ method: 'DELETE', url: this.postUrl(postId), accessToken: credential.accessToken }));
    if (this.data(response.body).deleted !== true) throw new ServiceUnavailableException('X did not confirm deletion of the post.');
  }

  async getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult> {
    const credential = await this.readCredential(socialAccountId);
    const response = await this.billed(credential, 'post_read', () => this.http.request({
      method: 'GET', url: this.postUrl(postId), accessToken: credential.accessToken, parameters: { 'tweet.fields': 'id,text' },
    }));
    const data = this.data(response.body);
    return { remotePostId: this.string(data.id) ?? postId, status: 'published' };
  }

  async getAnalytics(postId: string, socialAccountId?: string): Promise<PostAnalytics> {
    const credential = await this.readCredential(socialAccountId);
    const template = process.env.X_ANALYTICS_URL;
    if (!template) throw new NotImplementedException('X_ANALYTICS_URL configuration is required.');
    const response = await this.billed(credential, 'post_read', () => this.http.request({
      method: 'GET', url: template.replace('{postId}', encodeURIComponent(postId)), accessToken: credential.accessToken,
    }));
    const payload = this.data(response.body);
    const metrics = this.object(payload.metrics ?? payload.public_metrics ?? payload.organic_metrics ?? payload);
    const views = this.number(metrics.views ?? metrics.impression_count ?? metrics.impressions);
    if (views === null) throw new ServiceUnavailableException('X analytics response lacks view metrics.');
    return {
      views, likes: this.number(metrics.like_count ?? metrics.likes) ?? 0,
      comments: this.number(metrics.reply_count ?? metrics.comments) ?? 0,
      shares: this.number(metrics.retweet_count ?? metrics.repost_count ?? metrics.shares) ?? 0,
      clicks: this.number(metrics.url_link_clicks ?? metrics.clicks) ?? 0, capturedAt: new Date(),
    };
  }

  private async createPost(socialAccountId: string, text: string, mediaIds: readonly string[]): Promise<PublishResult> {
    const credential = await this.writeCredential(socialAccountId);
    const response = await this.billed(credential, this.containsUrl(text) ? 'post_create_with_url' : 'post_create', () => this.http.request({
      method: 'POST', url: this.postsUrl(), accessToken: credential.accessToken,
      body: { text, ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}) },
    }));
    const data = this.data(response.body);
    const remotePostId = this.string(data.id);
    if (!remotePostId) throw new ServiceUnavailableException('X API did not return a created post ID.');
    return { remotePostId, publishedAt: new Date() };
  }

  private async billed<T extends { body: unknown }>(credential: XPublishingCredential, operation: XUsageOperation, request: () => Promise<T>): Promise<T> {
    const quote = this.costs.estimate(operation);
    const reservation = await this.usage.reserve({ socialAccountId: credential.socialAccountId, operation, ...quote });
    try {
      const response = await request();
      await this.settleWithoutBreakingPublication(reservation.id, 'succeeded', this.externalReference(response.body));
      return response;
    } catch (error) {
      await this.settleWithoutBreakingPublication(reservation.id, 'failed');
      throw error;
    }
  }

  private async settleWithoutBreakingPublication(id: string, outcome: 'succeeded' | 'failed', externalReference?: string): Promise<void> {
    try { await this.usage.settle(id, outcome, externalReference); }
    catch { this.logger.warn(`X API usage reservation ${id} could not be settled after the external request.`); }
  }

  private async writeCredential(socialAccountId: string | undefined): Promise<XPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScopes(credential, ['tweet.read', 'tweet.write', 'users.read']);
    return credential;
  }

  private async readCredential(socialAccountId: string | undefined): Promise<XPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScopes(credential, ['tweet.read', 'users.read']);
    return credential;
  }

  private async resolve(socialAccountId: string | undefined): Promise<XPublishingCredential> {
    if (!socialAccountId) throw new ForbiddenException('X account context is required.');
    return this.credentials.resolve(socialAccountId);
  }

  private requireScopes(credential: XPublishingCredential, scopes: readonly string[]): void {
    const missing = scopes.find((scope) => !credential.scope.has(scope));
    if (missing) throw new ForbiddenException(`X account is missing required scope: ${missing}.`);
  }

  private postText(post: SocialPost): string {
    const parts = [post.body.trim(), post.destinationUrl].filter((part): part is string => Boolean(part));
    const text = parts.join('\n');
    if (!text && post.media.length === 0) throw new TypeError('X publishing requires text or media.');
    return text;
  }

  private baseUrl(): string {
    const value = process.env.X_API_BASE_URL;
    if (!value) throw new ServiceUnavailableException('X_API_BASE_URL is not configured.');
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new ServiceUnavailableException('X_API_BASE_URL must use HTTPS.');
    return url.toString().replace(/\/$/, '');
  }

  private postsUrl(): string { return `${this.baseUrl()}/2/tweets`; }
  private postUrl(postId: string): string { return `${this.postsUrl()}/${encodeURIComponent(postId)}`; }
  private mediaUploadUrl(): string { return `${this.baseUrl()}/2/media/upload`; }
  private containsUrl(text: string): boolean { return /https?:\/\//i.test(text); }
  private data(value: unknown): Record<string, unknown> { return this.object(this.object(value).data); }
  private externalReference(value: unknown): string | undefined { return this.string(this.data(value).id) ?? undefined; }
  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('X API returned an invalid JSON response.');
    return value as Record<string, unknown>;
  }
  private string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
  private number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
}
