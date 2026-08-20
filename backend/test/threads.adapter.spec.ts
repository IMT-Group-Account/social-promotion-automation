import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ThreadsAdapter } from '../src/publishing/adapters/threads.adapter';
import type { ThreadsCredentialResolver, ThreadsPublishingCredential } from '../src/publishing/adapters/threads-credential.service';
import type { ThreadsHttpClient, ThreadsHttpRequest, ThreadsHttpResponse } from '../src/publishing/adapters/threads-http.client';

process.env.THREADS_GRAPH_API_BASE_URL = 'https://graph.threads.net/v1.0';

class TestCredentialResolver implements ThreadsCredentialResolver {
  constructor(private readonly credential: ThreadsPublishingCredential) {}
  async resolve(): Promise<ThreadsPublishingCredential> { return this.credential; }
}

class TestHttpClient implements ThreadsHttpClient {
  readonly requests: ThreadsHttpRequest[] = [];
  constructor(private readonly responses: ThreadsHttpResponse[]) {}

  async request(input: ThreadsHttpRequest): Promise<ThreadsHttpResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected Threads request.');
    return response;
  }
}

function credential(scopes: readonly string[] = ['threads_basic', 'threads_content_publish']): ThreadsPublishingCredential {
  return { socialAccountId: 'threads-account-001', threadsUserId: '12345678901234567', accessToken: 'server-only-threads-token', scope: new Set(scopes) };
}

test('creates then publishes a Threads image container using a separate Threads credential', async () => {
  const http = new TestHttpClient([
    { status: 200, body: { id: 'threads-container-001' } },
    { status: 200, body: { id: 'threads-post-001' } },
  ]);
  const adapter = new ThreadsAdapter(new TestCredentialResolver(credential()), http);
  const result = await adapter.publish({
    localPostId: 'post_001', socialAccountId: 'threads-account-001', platform: 'threads', title: 'Campaign',
    body: 'Support our campaign', destinationUrl: 'https://example.com/campaign/123',
    media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }],
  });

  assert.equal(result.remotePostId, 'threads-post-001');
  assert.deepEqual(http.requests[0], {
    method: 'POST', url: 'https://graph.threads.net/v1.0/12345678901234567/threads', accessToken: 'server-only-threads-token',
    parameters: { media_type: 'IMAGE', image_url: 'https://cdn.example.com/image.jpg', text: 'Support our campaign\nhttps://example.com/campaign/123' },
  });
  assert.deepEqual(http.requests[1], {
    method: 'POST', url: 'https://graph.threads.net/v1.0/12345678901234567/threads_publish', accessToken: 'server-only-threads-token',
    parameters: { creation_id: 'threads-container-001' },
  });
});

test('reads Threads replies through the independent Threads adapter', async () => {
  const http = new TestHttpClient([{ status: 200, body: { data: [{ id: 'reply-001', text: 'Thanks!', username: 'supporter', permalink: 'https://www.threads.net/@supporter/post/reply-001', timestamp: '2026-08-20T00:00:00+0000' }] } }]);
  const adapter = new ThreadsAdapter(new TestCredentialResolver(credential()), http);
  const replies = await adapter.getReplies('threads-post-001', 'threads-account-001');
  assert.deepEqual(replies, [{ id: 'reply-001', text: 'Thanks!', username: 'supporter', permalink: 'https://www.threads.net/@supporter/post/reply-001', timestamp: '2026-08-20T00:00:00+0000' }]);
  assert.deepEqual(http.requests[0], {
    method: 'GET', url: 'https://graph.threads.net/v1.0/threads-post-001/replies', accessToken: 'server-only-threads-token',
    parameters: { fields: 'id,permalink,text,timestamp,username' },
  });
});

test('does not create a Threads container without threads_content_publish', async () => {
  const adapter = new ThreadsAdapter(new TestCredentialResolver(credential(['threads_basic'])), new TestHttpClient([]));
  await assert.rejects(() => adapter.createContainer({ socialAccountId: 'threads-account-001', text: 'Campaign', media: [] }), ForbiddenException);
});
