import { Injectable } from '@nestjs/common';
import { type OriginalCampaignContent, type PlatformContentFormatter, type XPlatformContent } from './platform-content.interface';
import { compact, titleAndMessage } from './text-formatting';

@Injectable()
export class XContentFormatter implements PlatformContentFormatter<XPlatformContent> {
  readonly platform = 'x' as const;
  format(input: OriginalCampaignContent): XPlatformContent {
    const urlLength = input.url ? [...input.url].length + 1 : 0;
    return { text: compact(titleAndMessage(input), Math.max(1, 280 - urlLength)) };
  }
}
