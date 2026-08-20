import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MediaService } from '../media/media.service';
import { type CreatePostDto } from './post.dto';
import { POST_REPOSITORY, type PostRepository } from './post.repository';
import { type Post, type PostStatus, SOCIAL_PLATFORMS, type SocialPublishJob } from './post.entity';

@Injectable()
export class PostService {
  constructor(@Inject(POST_REPOSITORY) private readonly repository: PostRepository, private readonly media: MediaService) {}

  create(ownerId: string, dto: CreatePostDto): { post: Post; jobs: readonly SocialPublishJob[] } {
    this.assertInput(dto);
    const scheduledAt = new Date(dto.scheduledAt);
    const post: Post = {
      id: randomUUID(), campaignId: dto.campaignId, ownerId,
      content: { ...dto.content, url: dto.content.url ?? null, media: this.media.validate(dto.content.media) },
      scheduledAt, status: 'scheduled',
    };
    const jobs: readonly SocialPublishJob[] = dto.targets.map((target) => ({
      id: randomUUID(), postId: post.id, platform: target.platform, accountId: target.accountId,
      status: 'waiting', scheduledAt, publishedAt: null, remotePostId: null, remotePostUrl: null,
      errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: null, nextRetryAt: null,
    }));
    this.repository.save(post, jobs);
    return { post, jobs };
  }

  summarizeStatus(jobs: readonly SocialPublishJob[]): PostStatus {
    if (jobs.length === 0) throw new TypeError('At least one publish job is required.');
    if (jobs.every((job) => job.status === 'published')) return 'completed';
    if (jobs.every((job) => job.status === 'failed' || job.status === 'cancelled')) return 'failed';
    if (jobs.some((job) => job.status === 'failed' || job.status === 'cancelled')) return 'partially_failed';
    if (jobs.some((job) => job.status === 'processing')) return 'publishing';
    return 'scheduled';
  }

  findOwned(postId: string, ownerId: string): { post: Post; jobs: readonly SocialPublishJob[] } {
    const post = this.repository.findPostById(postId);
    if (!post || post.ownerId !== ownerId) throw new NotFoundException('Post not found.');
    return { post, jobs: this.repository.findJobsByPostId(postId) };
  }

  schedule(ownerId: string, postId: string, scheduledAtInput: string): { post: Post; jobs: readonly SocialPublishJob[] } {
    const { post, jobs } = this.findOwned(postId, ownerId);
    const scheduledAt = new Date(scheduledAtInput);
    if (Number.isNaN(scheduledAt.valueOf())) throw new TypeError('scheduledAt must be ISO-8601.');
    if (scheduledAt <= new Date()) throw new RangeError('scheduledAt must be in the future.');
    if (jobs.some((job) => job.status === 'published' || job.status === 'processing')) {
      throw new RangeError('Published or processing jobs cannot be rescheduled.');
    }
    const updatedPost: Post = { ...post, scheduledAt, status: 'scheduled' };
    const updatedJobs = jobs.map((job) => job.status === 'cancelled' ? job : {
      ...job, status: 'waiting' as const, scheduledAt, nextRetryAt: null, errorCode: null, errorMessage: null, leaseExpiresAt: null,
    });
    this.repository.replacePost(updatedPost);
    updatedJobs.forEach((job) => this.repository.replaceJob(job));
    return { post: updatedPost, jobs: updatedJobs };
  }

  publishNow(ownerId: string, postId: string): { post: Post; jobs: readonly SocialPublishJob[] } {
    return this.schedule(ownerId, postId, new Date(Date.now() + 1_000).toISOString());
  }

  private assertInput(dto: CreatePostDto): void {
    if (!dto.campaignId?.trim() || typeof dto.content?.body !== 'string' || !dto.content.body.trim() || typeof dto.content.title !== 'string') {
      throw new TypeError('Campaign ID, content title, and content body are required.');
    }
    if (dto.content.title.length > 300 || dto.content.body.length > 10_000) throw new RangeError('Post content exceeds its limit.');
    if (!Array.isArray(dto.content.media)) throw new TypeError('content.media must be an array.');
    if (!Array.isArray(dto.targets) || dto.targets.length === 0) throw new TypeError('At least one social target is required.');
    if (Number.isNaN(new Date(dto.scheduledAt).valueOf())) throw new TypeError('scheduledAt must be ISO-8601.');
    const seen = new Set<string>();
    for (const target of dto.targets) {
      if (!SOCIAL_PLATFORMS.includes(target.platform) || !target.accountId?.trim()) throw new TypeError('Target platform or account is invalid.');
      const key = `${target.platform}:${target.accountId}`;
      if (seen.has(key)) throw new RangeError(`Duplicate social target: ${key}.`);
      seen.add(key);
    }
  }
}
