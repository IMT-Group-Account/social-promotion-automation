import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { LinkedInAdapter } from '../src/publishing/adapters/linkedin.adapter';
import type { LinkedInCredentialResolver, LinkedInPublishingCredential } from '../src/publishing/adapters/linkedin-credential.service';
import type { LinkedInHttpClient, LinkedInHttpRequest, LinkedInHttpResponse } from '../src/publishing/adapters/linkedin-http.client';

process.env.LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';
process.env.LINKEDIN_API_VERSION = '202608';

class TestCredentialResolver implements LinkedInCredentialResolver {
  constructor(private readonly credential: LinkedInPublishingCredential) {}
  async resolve(): Promise<LinkedInPublishingCredential> { return this.credential; }
}

class TestHttpClient implements LinkedInHttpClient {
  requestInput: LinkedInHttpRequest | undefined;
  async request(input: LinkedInHttpRequest): Promise<LinkedInHttpResponse> {
    this.requestInput = input;
    return { status: 201, headers: new Headers({ 'x-restli-id': 'urn:li:share:123' }), body: null };
  }
}

function organizationCredential(scopes: readonly string[] = ['w_organization_social', 'r_organization_social']): LinkedInPublishingCredential {
  return { socialAccountId: 'linkedin-account-001', authorUrn: 'urn:li:organization:123456', accessToken: 'server-only-token', scope: new Set(scopes) };
}

test('creates an organization text post with the Posts API payload', async () => {
  const http = new TestHttpClient();
  const adapter = new LinkedInAdapter(new TestCredentialResolver(organizationCredential()), http);
  const result = await adapter.publishText({ socialAccountId: 'linkedin-account-001', commentary: 'Support our campaign' });

  assert.equal(result.remotePostId, 'urn:li:share:123');
  assert.deepEqual(http.requestInput, {
    method: 'POST', url: 'https://api.linkedin.com/rest/posts', accessToken: 'server-only-token',
    body: {
      author: 'urn:li:organization:123456', commentary: 'Support our campaign', visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    },
  });
});

test('rejects an organization post when w_organization_social is absent', async () => {
  const adapter = new LinkedInAdapter(new TestCredentialResolver(organizationCredential(['w_member_social'])), new TestHttpClient());
  await assert.rejects(() => adapter.publishText({ socialAccountId: 'linkedin-account-001', commentary: 'Support our campaign' }), ForbiddenException);
});

test('requires uploaded LinkedIn asset URNs for image and video publishing', async () => {
  const adapter = new LinkedInAdapter(new TestCredentialResolver(organizationCredential()), new TestHttpClient());
  await assert.rejects(() => adapter.publish({
    localPostId: 'post_001', socialAccountId: 'linkedin-account-001', platform: 'linkedin', title: 'Campaign', body: 'Support', destinationUrl: null,
    media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }],
  }), /must be uploaded first/);
});
