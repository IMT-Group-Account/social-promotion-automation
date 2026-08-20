import { Inject, Injectable } from '@nestjs/common';
import { type Post, type SocialPublishJob } from '../posts/post.entity';
import { type SocialPost } from './adapters/social-adapter.interface';
import {
  PLATFORM_CONTENT_FORMATTERS, type FacebookPlatformContent, type InstagramPlatformContent, type LinkedInPlatformContent,
  type OriginalCampaignContent, type PlatformContent, type PlatformContentFormatter, type PlatformContents, type ThreadsPlatformContent, type XPlatformContent,
} from './formatters/platform-content.interface';
import { LinkedInContentFormatter } from './formatters/linkedin-content.formatter';
import { InstagramContentFormatter } from './formatters/instagram-content.formatter';
import { FacebookContentFormatter } from './formatters/facebook-content.formatter';
import { ThreadsContentFormatter } from './formatters/threads-content.formatter';
import { XContentFormatter } from './formatters/x-content.formatter';

const DEFAULT_FORMATTERS: readonly PlatformContentFormatter[] = [
  new LinkedInContentFormatter(), new InstagramContentFormatter(), new FacebookContentFormatter(), new ThreadsContentFormatter(), new XContentFormatter(),
];

@Injectable()
export class FormatterService {
  private readonly formattersByPlatform: ReadonlyMap<string, PlatformContentFormatter>;

  constructor(@Inject(PLATFORM_CONTENT_FORMATTERS) formatters: readonly PlatformContentFormatter[] = DEFAULT_FORMATTERS) {
    this.formattersByPlatform = new Map(formatters.map((formatter) => [formatter.platform, formatter]));
  }

  format(post: Post, job: SocialPublishJob): SocialPost {
    const bundle = this.formatAll(post);
    const content = bundle.platformContents[job.platform];
    return {
      localPostId: post.id,
      socialAccountId: job.accountId,
      platform: job.platform,
      title: post.content.title,
      body: this.textFor(job.platform, content),
      destinationUrl: post.content.url,
      media: post.content.media,
      formattedContent: content,
    };
  }

  formatAll(post: Post): { original: OriginalCampaignContent; platformContents: PlatformContents } {
    const original: OriginalCampaignContent = { title: post.content.title, message: post.content.body, url: post.content.url };
    const formatter = <T extends keyof PlatformContents>(platform: T): PlatformContents[T] => {
      const candidate = this.formattersByPlatform.get(platform);
      if (!candidate) throw new Error(`No content formatter is registered for ${platform}.`);
      return candidate.format(original) as PlatformContents[T];
    };
    return {
      original,
      platformContents: {
        linkedin: formatter('linkedin'), instagram: formatter('instagram'), facebook: formatter('facebook'),
        threads: formatter('threads'), x: formatter('x'),
      },
    };
  }

  private textFor(platform: SocialPublishJob['platform'], content: PlatformContent): string {
    switch (platform) {
      case 'linkedin': return (content as LinkedInPlatformContent).text;
      case 'instagram': return (content as InstagramPlatformContent).caption;
      case 'facebook': return (content as FacebookPlatformContent).message;
      case 'threads': return (content as ThreadsPlatformContent).text;
      case 'x': return (content as XPlatformContent).text;
    }
  }
}
