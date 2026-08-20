import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SocialApiHttpError } from '../publish-failure';

export interface InstagramHttpRequest { method: 'GET' | 'POST'; url: string; accessToken: string; parameters?: Readonly<Record<string, string>>; }
export interface InstagramHttpResponse { status: number; body: unknown; }
export interface InstagramHttpClient { request(input: InstagramHttpRequest): Promise<InstagramHttpResponse>; }
export const INSTAGRAM_HTTP_CLIENT = Symbol('INSTAGRAM_HTTP_CLIENT');

@Injectable()
export class FetchInstagramHttpClient implements InstagramHttpClient {
  async request(input: InstagramHttpRequest): Promise<InstagramHttpResponse> {
    const parameters = new URLSearchParams(input.parameters);
    const url = input.method === 'GET' ? this.withQuery(input.url, parameters) : input.url;
    const response = await fetch(url, {
      method: input.method,
      headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json', ...(input.method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) },
      body: input.method === 'GET' ? undefined : parameters,
    });
    if (!response.ok) throw new SocialApiHttpError('Instagram Graph', response.status);
    return { status: response.status, body: await response.json() };
  }

  private withQuery(urlText: string, parameters: URLSearchParams): string {
    try { const url = new URL(urlText); parameters.forEach((value, key) => url.searchParams.set(key, value)); return url.toString(); }
    catch { throw new ServiceUnavailableException('Instagram Graph API URL is invalid.'); }
  }
}
