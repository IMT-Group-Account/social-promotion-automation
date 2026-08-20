import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { FacebookAdapter } from '../src/publishing/adapters/facebook.adapter';
import type { FacebookCredentialResolver, FacebookPageCredential } from '../src/publishing/adapters/facebook-credential.service';
import type { FacebookHttpClient, FacebookHttpRequest, FacebookHttpResponse } from '../src/publishing/adapters/facebook-http.client';

process.env.FACEBOOK_GRAPH_API_BASE_URL = 'https://graph.facebook.com/v25.0';

class TestCredentialResolver implements FacebookCredentialResolver {
  constructor(private readonly credential: FacebookPageCredential) {}
  async resolve(): Promise<FacebookPageCredential> { return this.credential; }
}
class TestHttpClient implements FacebookHttpClient {
  requestInput: FacebookHttpRequest | undefined;
  async request(input: FacebookHttpRequest): Promise<FacebookHttpResponse> { this.requestInput = input; return { status: 200, body: { post_id: '123_456' } }; }
}
function pageCredential(scopes: readonly string[] = ['pages_manage_posts', 'pages_read_engagement']): FacebookPageCredential {
  return { socialAccountId: 'facebook-account-001', pageId: '123456789', accessToken: 'server-only-page-token', scope: new Set(scopes) };
}

test('routes text content to the Facebook Page Feed API', async () => {
  const http = new TestHttpClient();
  const adapter = new FacebookAdapter(new TestCredentialResolver(pageCredential()), http);
  const result = await adapter.publish({ localPostId: 'post_001', socialAccountId: 'facebook-account-001', platform: 'facebook', title: 'Campaign', body: 'Support our campaign', destinationUrl: null, media: [] });
  assert.equal(result.remotePostId, '123_456');
  assert.deepEqual(http.requestInput, { method: 'POST', url: 'https://graph.facebook.com/v25.0/123456789/feed', accessToken: 'server-only-page-token', parameters: { message: 'Support our campaign' } });
});

test('routes an image to the Photo API', async () => {
  const http = new TestHttpClient();
  const adapter = new FacebookAdapter(new TestCredentialResolver(pageCredential()), http);
  await adapter.publish({ localPostId: 'post_001', socialAccountId: 'facebook-account-001', platform: 'facebook', title: 'Campaign', body: 'Support our campaign', destinationUrl: null, media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }] });
  assert.equal(http.requestInput?.url, 'https://graph.facebook.com/v25.0/123456789/photos');
  assert.deepEqual(http.requestInput?.parameters, { url: 'https://cdn.example.com/image.jpg', caption: 'Support our campaign' });
});

test('rejects publishing without pages_manage_posts', async () => {
  const adapter = new FacebookAdapter(new TestCredentialResolver(pageCredential(['pages_read_engagement'])), new TestHttpClient());
  await assert.rejects(() => adapter.publishText({ socialAccountId: 'facebook-account-001', message: 'Support' }), ForbiddenException);
});
