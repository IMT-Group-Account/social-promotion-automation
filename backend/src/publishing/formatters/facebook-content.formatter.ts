import { Injectable } from '@nestjs/common';
import { type FacebookPlatformContent, type OriginalCampaignContent, type PlatformContentFormatter } from './platform-content.interface';
import { titleAndMessage } from './text-formatting';

@Injectable()
export class FacebookContentFormatter implements PlatformContentFormatter<FacebookPlatformContent> {
  readonly platform = 'facebook' as const;
  format(input: OriginalCampaignContent): FacebookPlatformContent { return { message: titleAndMessage(input) }; }
}
