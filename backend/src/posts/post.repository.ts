import { type Post, type SocialPublishJob } from './post.entity';

export const POST_REPOSITORY = Symbol('POST_REPOSITORY');

export interface PostRepository {
  save(post: Post, jobs: readonly SocialPublishJob[]): void;
  findPostById(postId: string): Post | null;
  findJobsByPostId(postId: string): readonly SocialPublishJob[];
  replacePost(post: Post): void;
  replaceJob(job: SocialPublishJob): void;
}

/** Temporary process-local implementation. Replace this provider with a PostgreSQL repository before deployment. */
export class InMemoryPostRepository implements PostRepository {
  private readonly posts = new Map<string, Post>();
  private readonly jobs = new Map<string, SocialPublishJob>();

  save(post: Post, jobs: readonly SocialPublishJob[]): void {
    this.posts.set(post.id, post);
    jobs.forEach((job) => this.jobs.set(job.id, job));
  }

  findPostById(postId: string): Post | null { return this.posts.get(postId) ?? null; }

  findJobsByPostId(postId: string): readonly SocialPublishJob[] {
    return [...this.jobs.values()].filter((job) => job.postId === postId);
  }

  replacePost(post: Post): void { this.posts.set(post.id, post); }
  replaceJob(job: SocialPublishJob): void { this.jobs.set(job.id, job); }
}
