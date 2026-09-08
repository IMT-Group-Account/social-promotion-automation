import { NotFoundException } from '@nestjs/common';
import { type Post, type SocialPublishJob } from './post.entity';
export const POST_REPOSITORY = Symbol('POST_REPOSITORY');
export interface PostRecord { post: Post; jobs: readonly SocialPublishJob[]; }
export interface PostRepository {
  save(post: Post, jobs: readonly SocialPublishJob[]): Promise<void>;
  findOwned(postId: string, ownerId: string): Promise<PostRecord>;
  list(ownerId: string, offset: number): Promise<readonly PostRecord[]>;
  mutate(postId: string, ownerId: string, work: (record: PostRecord) => PostRecord): Promise<PostRecord>;
}
/** Test fixture only; never registered in the application. */
export class InMemoryPostRepository implements PostRepository {
  private records = new Map<string, PostRecord>();
  async save(post: Post, jobs: readonly SocialPublishJob[]): Promise<void> { this.records.set(post.id, structuredClone({ post, jobs })); }
  async findOwned(id: string, ownerId: string): Promise<PostRecord> {
    const record = this.records.get(id);
    if (!record || record.post.ownerId !== ownerId) throw new NotFoundException('Post not found.');
    return structuredClone(record);
  }
  async list(ownerId: string, offset: number): Promise<readonly PostRecord[]> {
    return structuredClone([...this.records.values()].filter(r => r.post.ownerId === ownerId).slice(offset, offset + 50));
  }
  async mutate(id: string, ownerId: string, work: (record: PostRecord) => PostRecord): Promise<PostRecord> {
    const current = await this.findOwned(id, ownerId);
    const next = work(current); next.post = {...next.post, revision:(current.post.revision ?? 1)+1};
    await this.save(next.post, next.jobs); return next;
  }
}
