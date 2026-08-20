import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SocialApiHttpError } from '../publish-failure';

export interface FacebookHttpRequest { method: 'GET' | 'POST' | 'DELETE'; url: string; accessToken: string; parameters?: Readonly<Record<string, string>>; }
export interface FacebookHttpResponse { status: number; body: unknown; }
export interface FacebookHttpClient { request(input: FacebookHttpRequest): Promise<FacebookHttpResponse>; }
export const FACEBOOK_HTTP_CLIENT = Symbol('FACEBOOK_HTTP_CLIENT');

@Injectable()
export class FetchFacebookHttpClient implements FacebookHttpClient {
  async request(input: FacebookHttpRequest): Promise<FacebookHttpResponse> {
    const parameters = new URLSearchParams(input.parameters);
    const url = input.method === 'GET' ? this.withQuery(input.url, parameters) : input.url;
    const response = await fetch(url, {
      method: input.method,
      headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json', ...(input.method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) },
      body: input.method === 'GET' ? undefined : parameters,
    });
    if (!response.ok) throw new SocialApiHttpError('Meta Graph', response.status);
    const body: unknown = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  }

  private withQuery(urlText: string, parameters: URLSearchParams): string {
    try {
      const url = new URL(urlText);
      parameters.forEach((value, key) => url.searchParams.set(key, value));
      return url.toString();
    } catch { throw new ServiceUnavailableException('Facebook Graph API URL is invalid.'); }
  }
}
