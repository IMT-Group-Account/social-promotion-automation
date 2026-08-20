import { Injectable } from '@nestjs/common';
import { type LinkedInPlatformContent, type OriginalCampaignContent, type PlatformContentFormatter } from './platform-content.interface';
import { titleAndMessage } from './text-formatting';

@Injectable()
export class LinkedInContentFormatter implements PlatformContentFormatter<LinkedInPlatformContent> {
  readonly platform = 'linkedin' as const;
  format(input: OriginalCampaignContent): LinkedInPlatformContent { return { text: titleAndMessage(input) }; }
}
