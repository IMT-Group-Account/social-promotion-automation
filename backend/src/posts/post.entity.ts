export const SOCIAL_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'threads', 'x'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type PublishJobStatus = 'waiting' | 'claimed' | 'remote_requesting' | 'remote_confirmed' | 'published' | 'failed' | 'retrying' | 'cancelled';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'completed' | 'partially_failed' | 'failed' | 'cancelled';

export interface PostMedia { type: 'image' | 'video'; url: string; }
export interface PostContent { title: string; body: string; url: string | null; media: readonly PostMedia[]; platformBodies?: Partial<Record<SocialPlatform, string>>; }
export interface SocialTarget { platform: SocialPlatform; accountId: string; }
export interface Post { id: string; campaignId: string; ownerId: string; content: PostContent; scheduledAt: Date; status: PostStatus; revision?: number; }
export interface SocialPublishJob {
  id: string; postId: string; platform: SocialPlatform; accountId: string; status: PublishJobStatus; scheduledAt: Date;
  publishedAt: Date | null; remotePostId: string | null; remotePostUrl: string | null;
  errorCode: string | null; errorMessage: string | null; retryCount: number; leaseExpiresAt: Date | null; nextRetryAt: Date | null;
  remoteRequestKey: string | null; remoteRequestStartedAt: Date | null;
}
