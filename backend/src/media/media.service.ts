import { Injectable } from '@nestjs/common';
import { type PostMedia } from '../posts/post.entity';

@Injectable()
export class MediaService {
  validate(media: readonly PostMedia[]): readonly PostMedia[] {
    for (const item of media) {
      if (!['image', 'video'].includes(item.type)) throw new TypeError('Media type must be image or video.');
      try {
        const url = new URL(item.url);
        if (url.protocol !== 'https:') throw new TypeError('Media URLs must use HTTPS.');
      } catch {
        throw new TypeError('Media URL must be a valid HTTPS URL.');
      }
    }
    return media;
  }
}
