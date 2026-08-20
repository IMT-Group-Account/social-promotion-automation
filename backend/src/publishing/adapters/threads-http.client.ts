import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SocialApiHttpError } from '../publish-failure';

export interface ThreadsHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  accessToken: string;
  parameters?: Readonly<Record<string, string>>;
}

export interface ThreadsHttpResponse { status: number; body: unknown; }
export interface ThreadsHttpClient { request(input: ThreadsHttpRequest): Promise<ThreadsHttpResponse>; }
export const THREADS_HTTP_CLIENT = Symbol('THREADS_HTTP_CLIENT');

@Injectable()
export class FetchThreadsHttpClient implements ThreadsHttpClient {
  async request(input: ThreadsHttpRequest): Promise<ThreadsHttpResponse> {
    const parameters = new URLSearchParams(input.parameters);
    const url = input.method === 'GET' ? this.withQuery(input.url, parameters) : input.url;
    const response = await fetch(url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        ...(input.method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      },
      body: input.method === 'GET' ? undefined : parameters,
    });
    if (!response.ok) throw new SocialApiHttpError('Threads', response.status);
    return { status: response.status, body: await response.json() };
  }

  private withQuery(urlText: string, parameters: URLSearchParams): string {
    try {
      const url = new URL(urlText);
      parameters.forEach((value, key) => url.searchParams.set(key, value));
      return url.toString();
    } catch {
      throw new ServiceUnavailableException('Threads API URL is invalid.');
    }
  }
}
