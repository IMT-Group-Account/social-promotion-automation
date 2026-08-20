import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { InstagramAdapter } from '../src/publishing/adapters/instagram.adapter';
import type { InstagramCredentialResolver, InstagramPublishingCredential } from '../src/publishing/adapters/instagram-credential.service';
import type { InstagramHttpClient, InstagramHttpRequest, InstagramHttpResponse } from '../src/publishing/adapters/instagram-http.client';

process.env.INSTAGRAM_GRAPH_API_BASE_URL = 'https://graph.facebook.com/v25.0';
process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS = '1';
process.env.INSTAGRAM_CONTAINER_MAX_ATTEMPTS = '3';

class TestCredentialResolver implements InstagramCredentialResolver {
  constructor(private readonly credential: InstagramPublishingCredential) {}
  async resolve(): Promise<InstagramPublishingCredential> { return this.credential; }
}
class TestHttpClient implements InstagramHttpClient {
  readonly requests: InstagramHttpRequest[] = [];
  private readonly responses: InstagramHttpResponse[] = [
    { status: 200, body: { id: 'container_001' } },
    { status: 200, body: { status_code: 'IN_PROGRESS' } },
    { status: 200, body: { status_code: 'FINISHED' } },
    { status: 200, body: { id: 'ig_media_001' } },
  ];
  async request(input: InstagramHttpRequest): Promise<InstagramHttpResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected Instagram request.');
    return response;
  }
}
function credential(scopes: readonly string[] = ['instagram_basic', 'instagram_content_publish']): InstagramPublishingCredential {
  return { socialAccountId: 'instagram-account-001', instagramAccountId: '17841400000000001', accessToken: 'server-only-page-token', scope: new Set(scopes) };
}

test('creates, waits for, then publishes an Instagram media container', async () => {
  const http = new TestHttpClient();
  const adapter = new InstagramAdapter(new TestCredentialResolver(credential()), http);
  const result = await adapter.publish({
    localPostId: 'post_001', socialAccountId: 'instagram-account-001', platform: 'instagram', title: 'Campaign', body: 'Support our campaign', destinationUrl: null,
    media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }],
  });
  assert.equal(result.remotePostId, 'ig_media_001');
  assert.equal(http.requests.length, 4);
  assert.deepEqual(http.requests[0], {
    method: 'POST', url: 'https://graph.facebook.com/v25.0/17841400000000001/media', accessToken: 'server-only-page-token',
    parameters: { image_url: 'https://cdn.example.com/image.jpg', caption: 'Support our campaign' },
  });
  assert.equal(http.requests[3]?.url, 'https://graph.facebook.com/v25.0/17841400000000001/media_publish');
  assert.deepEqual(http.requests[3]?.parameters, { creation_id: 'container_001' });
});

test('does not create an Instagram container without instagram_content_publish', async () => {
  const adapter = new InstagramAdapter(new TestCredentialResolver(credential(['instagram_basic'])), new TestHttpClient());
  await assert.rejects(() => adapter.createContainer({ socialAccountId: 'instagram-account-001', mediaType: 'image', mediaUrl: 'https://cdn.example.com/image.jpg', caption: 'Campaign' }), ForbiddenException);
});
