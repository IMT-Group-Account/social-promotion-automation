import { ForbiddenException, Inject, Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { THREADS_CREDENTIAL_RESOLVER, type ThreadsCredentialResolver, type ThreadsPublishingCredential } from './threads-credential.service';
import { THREADS_HTTP_CLIENT, type ThreadsHttpClient } from './threads-http.client';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from './social-adapter.interface';

export interface ThreadsReply {
  id: string;
  text: string | null;
  username: string | null;
  permalink: string | null;
  timestamp: string | null;
}

/** Threads is independent from the Facebook and Instagram account/adapter boundaries. */
@Injectable()
export class ThreadsAdapter implements SocialAdapter {
  readonly platform = 'threads' as const;

  constructor(
    @Inject(THREADS_CREDENTIAL_RESOLVER) private readonly credentials: ThreadsCredentialResolver,
    @Inject(THREADS_HTTP_CLIENT) private readonly http: ThreadsHttpClient,
  ) {}

  async publish(post: SocialPost): Promise<PublishResult> {
    if (post.platform !== 'threads') throw new TypeError('Threads adapter can publish only Threads posts.');
    const container = await this.createContainer({ socialAccountId: post.socialAccountId, text: this.postText(post), media: post.media });
    return this.publishContainer(post.socialAccountId, container.id);
  }

  async createContainer(input: { socialAccountId: string; text: string; media: readonly { type: 'image' | 'video'; url: string }[] }): Promise<{ id: string }> {
    const credential = await this.writeCredential(input.socialAccountId);
    const response = await this.http.request({
      method: 'POST', url: this.edgeUrl(credential.threadsUserId, 'threads'), accessToken: credential.accessToken,
      parameters: this.containerParameters(input),
    });
    const id = this.string(this.object(response.body).id);
    if (!id) throw new ServiceUnavailableException('Threads did not return a content container ID.');
    return { id };
  }

  async publishContainer(socialAccountId: string, containerId: string): Promise<PublishResult> {
    const credential = await this.writeCredential(socialAccountId);
    const response = await this.http.request({
      method: 'POST', url: this.edgeUrl(credential.threadsUserId, 'threads_publish'), accessToken: credential.accessToken,
      parameters: { creation_id: containerId },
    });
    const remotePostId = this.string(this.object(response.body).id);
    if (!remotePostId) throw new ServiceUnavailableException('Threads did not return a published post ID.');
    return { remotePostId, publishedAt: new Date() };
  }

  async getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult> {
    const credential = await this.readCredential(socialAccountId);
    const response = await this.http.request({
      method: 'GET', url: this.objectUrl(postId), accessToken: credential.accessToken,
      parameters: { fields: 'id,permalink,text,timestamp,username' },
    });
    const payload = this.object(response.body);
    return { remotePostId: this.string(payload.id) ?? postId, remotePostUrl: this.string(payload.permalink) ?? undefined, status: 'published' };
  }

  async getReplies(postId: string, socialAccountId?: string): Promise<readonly ThreadsReply[]> {
    const credential = await this.readCredential(socialAccountId);
    const response = await this.http.request({
      method: 'GET', url: this.edgeUrl(postId, 'replies'), accessToken: credential.accessToken,
      parameters: { fields: 'id,permalink,text,timestamp,username' },
    });
    const payload = this.object(response.body);
    if (!Array.isArray(payload.data)) throw new ServiceUnavailableException('Threads replies response omitted data.');
    return payload.data.map((entry) => {
      const reply = this.object(entry);
      const id = this.string(reply.id);
      if (!id) throw new ServiceUnavailableException('Threads reply omitted an ID.');
      return { id, text: this.string(reply.text), username: this.string(reply.username), permalink: this.string(reply.permalink), timestamp: this.string(reply.timestamp) };
    });
  }

  async getAnalytics(postId: string, socialAccountId?: string): Promise<PostAnalytics> {
    const credential = await this.readCredential(socialAccountId);
    const template = process.env.THREADS_ANALYTICS_URL;
    if (!template) throw new NotImplementedException('THREADS_ANALYTICS_URL configuration is required.');
    const response = await this.http.request({ method: 'GET', url: template.replace('{postId}', encodeURIComponent(postId)), accessToken: credential.accessToken });
    const payload = this.object(response.body);
    const views = this.number(payload.views ?? payload.impressions ?? payload.reach);
    if (views === null) throw new ServiceUnavailableException('Threads analytics response lacks view metrics.');
    return {
      views, likes: this.number(payload.likes) ?? 0, comments: this.number(payload.comments ?? payload.replies) ?? 0,
      shares: this.number(payload.shares ?? payload.reposts) ?? 0, clicks: this.number(payload.clicks) ?? 0, capturedAt: new Date(),
    };
  }

  private containerParameters(input: { text: string; media: readonly { type: 'image' | 'video'; url: string }[] }): Record<string, string> {
    if (input.media.length > 1) throw new NotImplementedException('Threads carousel publishing is not implemented.');
    if (input.media.length === 0) return { media_type: 'TEXT', text: input.text };
    const media = input.media[0];
    if (!media) throw new TypeError('Threads media input is invalid.');
    return media.type === 'image'
      ? { media_type: 'IMAGE', image_url: this.https(media.url), text: input.text }
      : { media_type: 'VIDEO', video_url: this.https(media.url), text: input.text };
  }

  private postText(post: SocialPost): string {
    const parts = [post.body.trim(), post.destinationUrl].filter((part): part is string => Boolean(part));
    const text = parts.join('\n');
    if (!text) throw new TypeError('Threads publishing requires post text or a destination URL.');
    return text;
  }

  private async writeCredential(socialAccountId: string): Promise<ThreadsPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, 'threads_content_publish');
    return credential;
  }

  private async readCredential(socialAccountId: string | undefined): Promise<ThreadsPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, 'threads_basic');
    return credential;
  }

  private async resolve(socialAccountId: string | undefined): Promise<ThreadsPublishingCredential> {
    if (!socialAccountId) throw new ForbiddenException('Threads account context is required.');
    return this.credentials.resolve(socialAccountId);
  }

  private requireScope(credential: ThreadsPublishingCredential, scope: string): void {
    if (!credential.scope.has(scope)) throw new ForbiddenException(`Threads account is missing required scope: ${scope}.`);
  }

  private baseUrl(): string {
    const value = process.env.THREADS_GRAPH_API_BASE_URL;
    if (!value) throw new ServiceUnavailableException('THREADS_GRAPH_API_BASE_URL is not configured.');
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new ServiceUnavailableException('THREADS_GRAPH_API_BASE_URL must use HTTPS.');
    return url.toString().replace(/\/$/, '');
  }

  private edgeUrl(id: string, edge: string): string { return `${this.baseUrl()}/${encodeURIComponent(id)}/${edge}`; }
  private objectUrl(id: string): string { return `${this.baseUrl()}/${encodeURIComponent(id)}`; }

  private https(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new TypeError('Threads media URLs must use HTTPS.');
    return url.toString();
  }

  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('Threads API returned an invalid JSON response.');
    return value as Record<string, unknown>;
  }

  private string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
  private number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
}
