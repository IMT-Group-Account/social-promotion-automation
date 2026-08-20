import { ServiceUnavailableException } from '@nestjs/common';
import { type SocialPlatform } from '../../posts/post.entity';
import { type PublishResult, type SocialAdapter, type SocialPost, type SocialPostResult } from './social-adapter.interface';

/**
 * Safe default for channel adapters. Concrete API calls may be added only after
 * verified OAuth credentials, approval policy, and official API scopes exist.
 */
export abstract class NotConfiguredAdapter implements SocialAdapter {
  abstract readonly platform: SocialPlatform;

  async publish(_post: SocialPost): Promise<PublishResult> { throw this.unavailable(); }
  async getPost(_postId: string): Promise<SocialPostResult> { throw this.unavailable(); }

  protected unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(`${this.platform} publishing adapter is not configured.`);
  }
}
