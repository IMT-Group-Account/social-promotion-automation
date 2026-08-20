import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SocialApiHttpError } from '../publish-failure';

export interface XHttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  accessToken: string;
  body?: Readonly<Record<string, unknown>>;
  parameters?: Readonly<Record<string, string>>;
}

export interface XHttpResponse { status: number; body: unknown; }
export interface XHttpClient { request(input: XHttpRequest): Promise<XHttpResponse>; }
export const X_HTTP_CLIENT = Symbol('X_HTTP_CLIENT');

@Injectable()
export class FetchXHttpClient implements XHttpClient {
  async request(input: XHttpRequest): Promise<XHttpResponse> {
    const url = input.method === 'GET' ? this.withQuery(input.url, input.parameters) : input.url;
    const response = await fetch(url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        ...(input.body ? { 'content-type': 'application/json' } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) throw new SocialApiHttpError('X', response.status);
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }

  private withQuery(urlText: string, parameters: Readonly<Record<string, string>> | undefined): string {
    try {
      const url = new URL(urlText);
      for (const [key, value] of Object.entries(parameters ?? {})) url.searchParams.set(key, value);
      return url.toString();
    } catch {
      throw new ServiceUnavailableException('X API URL is invalid.');
    }
  }
}
