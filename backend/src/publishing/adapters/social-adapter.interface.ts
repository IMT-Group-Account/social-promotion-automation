import { type SocialPlatform } from '../../posts/post.entity';
import type { PlatformContent } from '../formatters/platform-content.interface';

export interface SocialPost {
  localPostId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  title: string;
  body: string;
  destinationUrl: string | null;
  media: readonly { type: 'image' | 'video'; url: string }[];
  formattedContent?: PlatformContent;
}

export interface PublishResult {
  remotePostId: string;
  remotePostUrl?: string;
  publishedAt: Date;
}

/** Stable per-job key. Adapters forward it only where the provider documents idempotent writes. */
export interface PublishRequest {
  idempotencyKey: string;
}

export type PublishReconciliation =
  | { status: 'confirmed'; result: PublishResult }
  | { status: 'not_found' | 'unknown' | 'unsupported' };

export interface SocialPostResult {
  remotePostId: string;
  remotePostUrl?: string;
  status: 'published' | 'not_found' | 'deleted' | 'unknown';
}

export interface PostAnalytics {
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reposts?: number;
  clicks?: number;
  rawMetrics?: Record<string, number>;
  capturedAt: Date;
}

export interface SocialAdapter {
  readonly platform: SocialPlatform;
  /** True only when this adapter sends the stable key to a verified provider idempotency mechanism. */
  readonly supportsIdempotentPublish?: boolean;
  publish(post: SocialPost, request: PublishRequest): Promise<PublishResult>;
  /** Optional provider-specific lookup by the stable publish request key. */
  reconcilePublish?(post: SocialPost, request: PublishRequest): Promise<PublishReconciliation>;
  getPost(remotePostId: string, socialAccountId: string): Promise<SocialPostResult>;
  deletePost?(remotePostId: string, socialAccountId: string): Promise<void>;
  getAnalytics?(remotePostId: string, socialAccountId: string): Promise<PostAnalytics>;
}

export const SOCIAL_ADAPTERS = Symbol('SOCIAL_ADAPTERS');
