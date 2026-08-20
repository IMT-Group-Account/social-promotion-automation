import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SocialApiHttpError } from '../publish-failure';

export interface LinkedInHttpRequest { method: 'GET' | 'POST' | 'DELETE'; url: string; accessToken: string; body?: unknown; extraHeaders?: Readonly<Record<string, string>>; }
export interface LinkedInHttpResponse { status: number; headers: Headers; body: unknown; }
export interface LinkedInHttpClient { request(input: LinkedInHttpRequest): Promise<LinkedInHttpResponse>; }
export const LINKEDIN_HTTP_CLIENT = Symbol('LINKEDIN_HTTP_CLIENT');

@Injectable()
export class FetchLinkedInHttpClient implements LinkedInHttpClient {
  async request(input: LinkedInHttpRequest): Promise<LinkedInHttpResponse> {
    const version = process.env.LINKEDIN_API_VERSION;
    if (!version || !/^\d{6}$/.test(version)) throw new ServiceUnavailableException('LINKEDIN_API_VERSION must use the YYYYMM format.');
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'LinkedIn-Version': version,
        'X-Restli-Protocol-Version': '2.0.0',
        ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...input.extraHeaders,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (!response.ok) throw new SocialApiHttpError('LinkedIn', response.status);
    const contentType = response.headers.get('content-type') ?? '';
    const body: unknown = contentType.includes('application/json') ? await response.json() : null;
    return { status: response.status, headers: response.headers, body };
  }
}
