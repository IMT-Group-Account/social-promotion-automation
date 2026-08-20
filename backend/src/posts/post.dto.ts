import { type PostContent, type SocialTarget } from './post.entity';

export interface CreatePostDto {
  campaignId: string;
  content: PostContent;
  targets: readonly SocialTarget[];
  scheduledAt: string;
}
