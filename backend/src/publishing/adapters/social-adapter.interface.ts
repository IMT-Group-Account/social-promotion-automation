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

export interface SocialPostResult {
  remotePostId: string;
  remotePostUrl?: string;
  status: 'published' | 'not_found' | 'deleted' | 'unknown';
}

export interface PostAnalytics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  capturedAt: Date;
}

export interface SocialAdapter {
  readonly platform: SocialPlatform;
  publish(post: SocialPost): Promise<PublishResult>;
  getPost(postId: string, socialAccountId?: string): Promise<SocialPostResult>;
  deletePost?(postId: string, socialAccountId?: string): Promise<void>;
  getAnalytics?(postId: string, socialAccountId?: string): Promise<PostAnalytics>;
}

export const SOCIAL_ADAPTERS = Symbol('SOCIAL_ADAPTERS');
