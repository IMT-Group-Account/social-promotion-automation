import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface XMediaSource {
  read(input: { url: string; type: 'image' | 'video' }): Promise<{ base64: string; mimeType: string }>;
}
export const X_MEDIA_SOURCE = Symbol('X_MEDIA_SOURCE');

/** Fetches only explicitly allowed HTTPS media origins to avoid X upload SSRF. */
@Injectable()
export class FetchXMediaSource implements XMediaSource {
  async read(input: { url: string; type: 'image' | 'video' }): Promise<{ base64: string; mimeType: string }> {
    const url = this.allowedUrl(input.url);
    const maximumBytes = this.positiveInteger('X_MEDIA_MAX_BYTES');
    const response = await fetch(url, { redirect: 'error', headers: { accept: input.type === 'image' ? 'image/*' : 'video/*' } });
    if (!response.ok) throw new ServiceUnavailableException(`X media source request failed (${response.status}).`);
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!mimeType.startsWith(`${input.type}/`)) throw new ServiceUnavailableException('X media source content type does not match the requested media type.');
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maximumBytes) throw new ServiceUnavailableException('X media source exceeds X_MEDIA_MAX_BYTES.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maximumBytes) throw new ServiceUnavailableException('X media source is empty or exceeds X_MEDIA_MAX_BYTES.');
    return { base64: bytes.toString('base64'), mimeType };
  }

  private allowedUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new ServiceUnavailableException('X media source URL is invalid.'); }
    if (url.protocol !== 'https:') throw new ServiceUnavailableException('X media source URL must use HTTPS.');
    const allowed = (process.env.X_MEDIA_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (allowed.length === 0 || !allowed.includes(url.hostname.toLowerCase())) {
      throw new ServiceUnavailableException('X media source host is not approved for server-side upload.');
    }
    return url;
  }

  private positiveInteger(name: string): number {
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new ServiceUnavailableException(`${name} must be a positive integer.`);
    return value;
  }
}
