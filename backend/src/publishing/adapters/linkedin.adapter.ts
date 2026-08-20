import { ForbiddenException, Inject, Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { LINKEDIN_CREDENTIAL_RESOLVER, type LinkedInCredentialResolver, type LinkedInPublishingCredential } from './linkedin-credential.service';
import { LINKEDIN_HTTP_CLIENT, type LinkedInHttpClient } from './linkedin-http.client';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from './social-adapter.interface';

@Injectable()
export class LinkedInAdapter implements SocialAdapter {
  readonly platform = 'linkedin' as const;

  constructor(
    @Inject(LINKEDIN_CREDENTIAL_RESOLVER) private readonly credentials: LinkedInCredentialResolver,
    @Inject(LINKEDIN_HTTP_CLIENT) private readonly http: LinkedInHttpClient,
  ) {}

  async publish(post: SocialPost): Promise<PublishResult> {
    if (post.platform !== 'linkedin') throw new TypeError('LinkedIn adapter can publish only LinkedIn posts.');
    if (post.media.length === 0 && post.destinationUrl) {
      return this.publishArticle({ socialAccountId: post.socialAccountId, commentary: post.body, source: post.destinationUrl, title: post.title, description: post.body });
    }
    if (post.media.length === 0) return this.publishText({ socialAccountId: post.socialAccountId, commentary: post.body });
    if (post.media.length !== 1) throw new NotImplementedException('LinkedIn multi-image publishing requires the dedicated MultiImage API.');
    const media = post.media[0];
    if (media.type === 'image' && media.url.startsWith('urn:li:image:')) {
      return this.publishImage({ socialAccountId: post.socialAccountId, commentary: post.body, imageUrn: media.url, title: post.title });
    }
    if (media.type === 'video' && media.url.startsWith('urn:li:video:')) {
      return this.publishVideo({ socialAccountId: post.socialAccountId, commentary: post.body, videoUrn: media.url, title: post.title });
    }
    throw new ServiceUnavailableException('LinkedIn media must be uploaded first and supplied as an Image or Video URN.');
  }

  publishText(input: { socialAccountId: string; commentary: string }): Promise<PublishResult> {
    return this.createPost(input.socialAccountId, input.commentary, undefined);
  }

  publishImage(input: { socialAccountId: string; commentary: string; imageUrn: string; title?: string }): Promise<PublishResult> {
    this.assertUrn(input.imageUrn, 'image');
    return this.createPost(input.socialAccountId, input.commentary, { media: { id: input.imageUrn, ...(input.title ? { title: input.title } : {}) } });
  }

  publishVideo(input: { socialAccountId: string; commentary: string; videoUrn: string; title?: string }): Promise<PublishResult> {
    this.assertUrn(input.videoUrn, 'video');
    return this.createPost(input.socialAccountId, input.commentary, { media: { id: input.videoUrn, ...(input.title ? { title: input.title } : {}) } });
  }

  publishArticle(input: { socialAccountId: string; commentary: string; source: string; title: string; description: string; thumbnailImageUrn?: string }): Promise<PublishResult> {
    const source = new URL(input.source);
    if (source.protocol !== 'https:') throw new TypeError('LinkedIn article source must use HTTPS.');
    if (input.thumbnailImageUrn) this.assertUrn(input.thumbnailImageUrn, 'image');
    return this.createPost(input.socialAccountId, input.commentary, {
      article: { source: source.toString(), title: input.title, description: input.description, ...(input.thumbnailImageUrn ? { thumbnail: input.thumbnailImageUrn } : {}) },
    });
  }

  async getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult> {
    const credential = await this.credentialForRead(socialAccountId);
    const response = await this.http.request({ method: 'GET', url: this.postUrl(postId), accessToken: credential.accessToken });
    const lifecycleState = this.readLifecycleState(response.body);
    return { remotePostId: postId, status: lifecycleState === 'PUBLISHED' ? 'published' : 'unknown' };
  }

  async deletePost(postId: string, socialAccountId?: string): Promise<void> {
    const credential = await this.credentialForWrite(socialAccountId);
    await this.http.request({ method: 'DELETE', url: this.postUrl(postId), accessToken: credential.accessToken, extraHeaders: { 'X-RestLi-Method': 'DELETE' } });
  }

  async getAnalytics(postId: string, socialAccountId?: string): Promise<PostAnalytics> { return this.getStatistics(postId, socialAccountId); }

  async getStatistics(postId: string, socialAccountId?: string): Promise<PostAnalytics> {
    const credential = await this.credentialForRead(socialAccountId);
    const template = process.env.LINKEDIN_ANALYTICS_URL;
    if (!template) throw new NotImplementedException('LinkedIn analytics endpoint configuration is required.');
    const url = template.replace('{postUrn}', encodeURIComponent(postId));
    const response = await this.http.request({ method: 'GET', url, accessToken: credential.accessToken });
    const payload = this.object(response.body);
    const views = this.number(payload.views ?? payload.impressions ?? payload.impressionCount);
    if (views === null) throw new ServiceUnavailableException('LinkedIn analytics response lacks view metrics.');
    return {
      views, likes: this.number(payload.likes ?? payload.reactions ?? payload.reactionCount) ?? 0,
      comments: this.number(payload.comments ?? payload.commentCount) ?? 0,
      shares: this.number(payload.shares ?? payload.shareCount) ?? 0,
      clicks: this.number(payload.clicks ?? payload.clickCount) ?? 0, capturedAt: new Date(),
    };
  }

  private async createPost(socialAccountId: string, commentary: string, content: Record<string, unknown> | undefined): Promise<PublishResult> {
    if (!commentary.trim()) throw new TypeError('LinkedIn commentary is required.');
    const credential = await this.credentialForWrite(socialAccountId);
    const response = await this.http.request({
      method: 'POST', url: this.postsUrl(), accessToken: credential.accessToken,
      body: {
        author: credential.authorUrn, commentary, visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}), lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      },
    });
    const remotePostId = response.headers.get('x-restli-id');
    if (response.status !== 201 || !remotePostId) throw new ServiceUnavailableException('LinkedIn did not return a created post URN.');
    return { remotePostId, publishedAt: new Date() };
  }

  private async credentialForWrite(socialAccountId: string | undefined): Promise<LinkedInPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, credential.authorUrn.startsWith('urn:li:organization:') ? 'w_organization_social' : 'w_member_social');
    return credential;
  }

  private async credentialForRead(socialAccountId: string | undefined): Promise<LinkedInPublishingCredential> {
    const credential = await this.resolve(socialAccountId);
    this.requireScope(credential, credential.authorUrn.startsWith('urn:li:organization:') ? 'r_organization_social' : 'r_member_social');
    return credential;
  }

  private async resolve(socialAccountId: string | undefined): Promise<LinkedInPublishingCredential> {
    if (!socialAccountId) throw new ForbiddenException('LinkedIn account context is required.');
    return this.credentials.resolve(socialAccountId);
  }

  private requireScope(credential: LinkedInPublishingCredential, scope: string): void {
    if (!credential.scope.has(scope)) throw new ForbiddenException(`LinkedIn account is missing required scope: ${scope}.`);
  }

  private postsUrl(): string {
    const url = process.env.LINKEDIN_POSTS_URL;
    if (!url) throw new ServiceUnavailableException('LINKEDIN_POSTS_URL is not configured.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new ServiceUnavailableException('LINKEDIN_POSTS_URL must use HTTPS.');
    return parsed.toString().replace(/\/$/, '');
  }

  private postUrl(postId: string): string { return `${this.postsUrl()}/${encodeURIComponent(postId)}`; }
  private assertUrn(value: string, assetType: 'image' | 'video'): void { if (!value.startsWith(`urn:li:${assetType}:`)) throw new TypeError(`Expected a LinkedIn ${assetType} URN.`); }
  private object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceUnavailableException('LinkedIn returned an invalid JSON response.'); return value as Record<string, unknown>; }
  private number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  private readLifecycleState(value: unknown): string | null { const lifecycle = this.object(value).lifecycleState; return typeof lifecycle === 'string' ? lifecycle : null; }
}
