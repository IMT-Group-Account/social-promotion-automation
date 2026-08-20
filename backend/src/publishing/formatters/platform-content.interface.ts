import type { SocialPlatform } from '../../posts/post.entity';

export interface OriginalCampaignContent {
  message: string;
  url: string | null;
  title: string;
}

export interface LinkedInPlatformContent { text: string; }
export interface InstagramPlatformContent { caption: string; hashtags: readonly string[]; }
export interface FacebookPlatformContent { message: string; }
export interface ThreadsPlatformContent { text: string; }
export interface XPlatformContent { text: string; }

export interface PlatformContents {
  linkedin: LinkedInPlatformContent;
  instagram: InstagramPlatformContent;
  facebook: FacebookPlatformContent;
  threads: ThreadsPlatformContent;
  x: XPlatformContent;
}

export type PlatformContent = PlatformContents[SocialPlatform];

export interface PlatformContentFormatter<T extends PlatformContent = PlatformContent> {
  readonly platform: SocialPlatform;
  format(input: OriginalCampaignContent): T;
}

/** Future AI providers can implement this port without changing adapters or jobs. */
export interface PlatformContentGenerationPort {
  generate(input: OriginalCampaignContent): Promise<PlatformContents>;
}

export const PLATFORM_CONTENT_FORMATTERS = Symbol('PLATFORM_CONTENT_FORMATTERS');
