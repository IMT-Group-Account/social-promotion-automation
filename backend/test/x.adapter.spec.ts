import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { XAdapter } from '../src/publishing/adapters/x.adapter';
import type { XCredentialResolver, XPublishingCredential } from '../src/publishing/adapters/x-credential.service';
import type { XHttpClient, XHttpRequest, XHttpResponse } from '../src/publishing/adapters/x-http.client';
import type { XMediaSource } from '../src/publishing/adapters/x-media-source.service';
import { XApiCostService, type XUsageLedger, type XUsageOperation } from '../src/publishing/x-api-usage.service';

process.env.X_API_BASE_URL = 'https://api.x.com';
process.env.X_API_PRICING_VERSION = 'x-console-2026-08-20';
process.env.X_API_COST_POST_CREATE_MICRO_USD = '15000';
process.env.X_API_COST_POST_CREATE_WITH_URL_MICRO_USD = '200000';
process.env.X_API_COST_MEDIA_UPLOAD_MICRO_USD = '5000';
process.env.X_API_COST_POST_READ_MICRO_USD = '5000';
process.env.X_API_COST_POST_DELETE_MICRO_USD = '10000';
process.env.X_API_MAX_ESTIMATED_COST_MICRO_USD_PER_REQUEST = '200000';

class TestCredentialResolver implements XCredentialResolver {
  constructor(private readonly credential: XPublishingCredential) {}
  async resolve(): Promise<XPublishingCredential> { return this.credential; }
}

class TestHttpClient implements XHttpClient {
  readonly requests: XHttpRequest[] = [];
  constructor(private readonly responses: XHttpResponse[]) {}
  async request(input: XHttpRequest): Promise<XHttpResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected X API request.');
    return response;
  }
}

class TestMediaSource implements XMediaSource {
  readonly inputs: { url: string; type: 'image' | 'video' }[] = [];
  async read(input: { url: string; type: 'image' | 'video' }): Promise<{ base64: string; mimeType: string }> {
    this.inputs.push(input);
    return { base64: 'aW1hZ2UtYnl0ZXM=', mimeType: 'image/jpeg' };
  }
}

class TestUsageLedger implements XUsageLedger {
  readonly reservations: { socialAccountId: string; operation: XUsageOperation; estimatedCostMicrousd: number; pricingVersion: string }[] = [];
  readonly settlements: { id: string; outcome: 'succeeded' | 'failed'; externalReference?: string }[] = [];
  async reserve(input: { socialAccountId: string; operation: XUsageOperation; estimatedCostMicrousd: number; pricingVersion: string }) {
    this.reservations.push(input);
    return { id: `usage-${this.reservations.length}`, operation: input.operation, estimatedCostMicrousd: input.estimatedCostMicrousd };
  }
  async settle(id: string, outcome: 'succeeded' | 'failed', externalReference?: string): Promise<void> { this.settlements.push({ id, outcome, externalReference }); }
}

function credential(scopes: readonly string[] = ['tweet.read', 'tweet.write', 'users.read']): XPublishingCredential {
  return { socialAccountId: 'x-account-001', xUserId: '1234567890', accessToken: 'server-only-x-token', scope: new Set(scopes) };
}

function adapter(http: TestHttpClient, source = new TestMediaSource(), ledger = new TestUsageLedger()): { adapter: XAdapter; source: TestMediaSource; ledger: TestUsageLedger } {
  return { adapter: new XAdapter(new TestCredentialResolver(credential()), http, source, ledger, new XApiCostService()), source, ledger };
}

test('publishes text to POST /2/tweets and records URL-priced usage before the request', async () => {
  const http = new TestHttpClient([{ status: 201, body: { data: { id: '1234567890', text: 'Support our campaign https://example.com' } } }]);
  const result = adapter(http);
  const published = await result.adapter.publishText({ socialAccountId: 'x-account-001', text: 'Support our campaign https://example.com' });

  assert.equal(published.remotePostId, '1234567890');
  assert.deepEqual(http.requests[0], {
    method: 'POST', url: 'https://api.x.com/2/tweets', accessToken: 'server-only-x-token',
    body: { text: 'Support our campaign https://example.com' },
  });
  assert.deepEqual(result.ledger.reservations, [{ socialAccountId: 'x-account-001', operation: 'post_create_with_url', estimatedCostMicrousd: 200000, pricingVersion: 'x-console-2026-08-20' }]);
  assert.deepEqual(result.ledger.settlements, [{ id: 'usage-1', outcome: 'succeeded', externalReference: '1234567890' }]);
});

test('uploads image media, then attaches the returned media_id to POST /2/tweets', async () => {
  const http = new TestHttpClient([
    { status: 200, body: { data: { id: 'media-001' } } },
    { status: 201, body: { data: { id: 'post-001' } } },
  ]);
  const result = adapter(http);
  const published = await result.adapter.publishMedia({
    socialAccountId: 'x-account-001', text: 'Campaign image', media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }],
  });

  assert.equal(published.remotePostId, 'post-001');
  assert.deepEqual(result.source.inputs, [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }]);
  assert.deepEqual(http.requests[0], {
    method: 'POST', url: 'https://api.x.com/2/media/upload', accessToken: 'server-only-x-token',
    body: { media: 'aW1hZ2UtYnl0ZXM=', media_category: 'tweet_image' },
  });
  assert.deepEqual(http.requests[1], {
    method: 'POST', url: 'https://api.x.com/2/tweets', accessToken: 'server-only-x-token',
    body: { text: 'Campaign image', media: { media_ids: ['media-001'] } },
  });
  assert.deepEqual(result.ledger.reservations.map(({ operation }) => operation), ['media_upload', 'post_create']);
});

test('gets and deletes only through the authenticated X user context', async () => {
  const http = new TestHttpClient([
    { status: 200, body: { data: { id: 'post-001', text: 'Campaign image' } } },
    { status: 200, body: { data: { deleted: true } } },
  ]);
  const result = adapter(http);
  const post = await result.adapter.getPost('post-001', 'x-account-001');
  await result.adapter.deletePost('post-001', 'x-account-001');
  assert.equal(post.remotePostId, 'post-001');
  assert.equal(http.requests[0]?.url, 'https://api.x.com/2/tweets/post-001');
  assert.equal(http.requests[1]?.method, 'DELETE');
  assert.deepEqual(result.ledger.reservations.map(({ operation }) => operation), ['post_read', 'post_delete']);
});

test('does not issue billable X requests without tweet.write', async () => {
  const http = new TestHttpClient([]);
  const ledger = new TestUsageLedger();
  const instance = new XAdapter(new TestCredentialResolver(credential(['tweet.read', 'users.read'])), http, new TestMediaSource(), ledger, new XApiCostService());
  await assert.rejects(() => instance.publishText({ socialAccountId: 'x-account-001', text: 'Campaign' }), ForbiddenException);
  assert.equal(ledger.reservations.length, 0);
});
