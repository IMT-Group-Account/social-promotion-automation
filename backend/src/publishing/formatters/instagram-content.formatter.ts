import { Injectable } from '@nestjs/common';
import { type InstagramPlatformContent, type OriginalCampaignContent, type PlatformContentFormatter } from './platform-content.interface';
import { extractHashtags, removeHashtags, titleAndMessage } from './text-formatting';

@Injectable()
export class InstagramContentFormatter implements PlatformContentFormatter<InstagramPlatformContent> {
  readonly platform = 'instagram' as const;

  format(input: OriginalCampaignContent): InstagramPlatformContent {
    const hashtags = extractHashtags(input.message);
    const message = titleAndMessage({ ...input, message: removeHashtags(input.message) });
    const caption = [message, input.url, hashtags.join(' ')].filter((part): part is string => Boolean(part)).join('\n\n');
    return { caption, hashtags };
  }
}
