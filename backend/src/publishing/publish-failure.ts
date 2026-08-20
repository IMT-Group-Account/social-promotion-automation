import { HttpException } from '@nestjs/common';

export type PublishFailureCode = 'TOKEN_EXPIRED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'UPSTREAM_SERVER_ERROR' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR';

export interface PublishFailure {
  code: PublishFailureCode;
  retryable: boolean;
  message: string;
}

/** Retains provider response status without exposing an access token or response body. */
export class SocialApiHttpError extends Error {
  constructor(public readonly platform: string, public readonly status: number) {
    super(`${platform} API request failed (${status}).`);
  }
}

export function classifyPublishFailure(error: unknown): PublishFailure {
  const status = statusOf(error);
  const message = safeMessage(error);
  if (status === 401) return { code: 'TOKEN_EXPIRED', retryable: false, message };
  if (status === 403) return { code: 'PERMISSION_DENIED', retryable: false, message };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true, message };
  if (status !== null && status >= 500) return { code: 'UPSTREAM_SERVER_ERROR', retryable: true, message };
  if (status !== null && status >= 400) return { code: 'INVALID_REQUEST', retryable: false, message };
  if (error instanceof TypeError || isNetworkCode(error)) return { code: 'NETWORK_ERROR', retryable: true, message };
  return { code: 'UNKNOWN_ERROR', retryable: true, message };
}

function statusOf(error: unknown): number | null {
  if (error instanceof SocialApiHttpError) return error.status;
  if (error instanceof HttpException) return error.getStatus();
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status;
  return null;
}

function isNetworkCode(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return typeof error.code === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown publishing error.';
}
