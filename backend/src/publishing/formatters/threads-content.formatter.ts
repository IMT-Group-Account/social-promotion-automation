import { Injectable } from '@nestjs/common';
import { type OriginalCampaignContent, type PlatformContentFormatter, type ThreadsPlatformContent } from './platform-content.interface';
import { compact } from './text-formatting';

@Injectable()
export class ThreadsContentFormatter implements PlatformContentFormatter<ThreadsPlatformContent> {
  readonly platform = 'threads' as const;
  format(input: OriginalCampaignContent): ThreadsPlatformContent { return { text: compact(input.message, 500) }; }
}
