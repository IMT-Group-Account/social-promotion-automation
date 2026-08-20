import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { OauthService } from '../src/auth/oauth.service';
import type { OAuthAccountRepository } from '../src/auth/oauth-account.repository';
import type { OAuthProvider } from '../src/auth/oauth-provider.interface';
import { TokenService } from '../src/auth/token.service';
import type { ConnectedSocialAccount, OAuthAuthorizationState, SocialAccountCredential } from '../src/auth/oauth.types';

process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION = 'test-v1';

class MemoryOAuthRepository implements OAuthAccountRepository {
  readonly states = new Map<string, OAuthAuthorizationState>();
  credential: SocialAccountCredential | undefined;

  async createState(state: OAuthAuthorizationState): Promise<void> { this.states.set(state.stateHash, state); }
  async consumeState(stateHash: string): Promise<OAuthAuthorizationState | null> {
    const state = this.states.get(stateHash) ?? null;
    this.states.delete(stateHash);
    return state;
  }
  async upsertSocialAccount(credential: SocialAccountCredential): Promise<ConnectedSocialAccount> {
    this.credential = credential;
    return {
      id: 'account_001', userId: credential.userId, platform: credential.platform, platformAccountId: credential.platformAccountId,
      accountName: credential.accountName, expiresAt: credential.expiresAt, scope: credential.scope, status: 'active',
    };
  }
  async findActiveSocialAccount(): Promise<null> { return null; }
  async listSocialAccounts() { return []; }
  async disconnectSocialAccount() { return false; }
  async createFacebookPageSelection(): Promise<void> { throw new Error('Not used in LinkedIn OAuth tests.'); }
  async consumeFacebookPageSelection(): Promise<null> { return null; }
}

class TestLinkedInProvider implements OAuthProvider {
  readonly platform = 'linkedin' as const;
  readonly callbackRoute = 'linkedin' as const;
  codeChallenge: string | undefined;

  createAuthorizationUrl(input: { state: string; codeChallenge: string }): URL {
    this.codeChallenge = input.codeChallenge;
    return new URL(`https://oauth.example/authorize?state=${encodeURIComponent(input.state)}`);
  }
  async exchangeCode(input: { code: string; codeVerifier: string }) {
    assert.equal(input.code, 'authorization-code');
    assert.equal(createHash('sha256').update(input.codeVerifier).digest('base64url'), this.codeChallenge);
    return { accessToken: 'access-token-secret', refreshToken: 'refresh-token-secret', expiresAt: new Date('2026-08-22T00:00:00Z'), scopes: ['w_member_social'] };
  }
  async fetchIdentity(accessToken: string) {
    assert.equal(accessToken, 'access-token-secret');
    return { platformAccountId: 'linkedin-member-123', accountName: 'Test Member' };
  }
}

class TestThreadsProvider implements OAuthProvider {
  readonly platform = 'threads' as const;
  readonly callbackRoute = 'threads' as const;

  createAuthorizationUrl(input: { state: string }): URL {
    return new URL(`https://threads.example/authorize?state=${encodeURIComponent(input.state)}`);
  }
  async exchangeCode() {
    return { accessToken: 'threads-access-token-secret', refreshToken: null, expiresAt: new Date('2026-09-20T00:00:00Z'), scopes: ['threads_basic', 'threads_content_publish'] };
  }
  async fetchIdentity() { return { platformAccountId: '12345678901234567', accountName: 'campaign.foundation' }; }
}

test('OAuth callback consumes state once and stores only encrypted server-side tokens', async () => {
  const repository = new MemoryOAuthRepository();
  const provider = new TestLinkedInProvider();
  const service = new OauthService(repository, [provider], new TokenService());
  const { authorizationUrl } = await service.beginAuthorization('user_001', 'linkedin');
  const state = new URL(authorizationUrl).searchParams.get('state');
  assert.ok(state);

  const account = await service.completeCallback('linkedin', { state, code: 'authorization-code' });
  assert.ok('platformAccountId' in account);
  assert.equal(account.platformAccountId, 'linkedin-member-123');
  assert.equal(JSON.stringify(account).includes('access-token-secret'), false);
  assert.ok(repository.credential);
  assert.equal(repository.credential.accessTokenEncrypted.includes('access-token-secret'), false);
  assert.equal(new TokenService().decrypt(repository.credential.accessTokenEncrypted), 'access-token-secret');
  await assert.rejects(() => service.completeCallback('linkedin', { state, code: 'authorization-code' }), /invalid, expired, or already used/);
});

test('token encryption is authenticated and never deterministic', () => {
  const service = new TokenService();
  const first = service.encrypt('same-secret');
  const second = service.encrypt('same-secret');
  assert.notEqual(first, second);
  assert.equal(service.decrypt(first), 'same-secret');
  assert.throws(() => service.decrypt(`${first}tampered`));
});

test('callback route must match the platform state that initiated authorization', async () => {
  const repository = new MemoryOAuthRepository();
  const provider = new TestLinkedInProvider();
  const service = new OauthService(repository, [provider], new TokenService());
  const { authorizationUrl } = await service.beginAuthorization('user_001', 'linkedin');
  const state = new URL(authorizationUrl).searchParams.get('state') ?? '';
  await assert.rejects(() => service.completeCallback('meta', { state, code: 'authorization-code' }), /invalid, expired, or already used/);
});

test('Threads OAuth callback stores an encrypted Threads user credential separately', async () => {
  const repository = new MemoryOAuthRepository();
  const provider = new TestThreadsProvider();
  const service = new OauthService(repository, [provider], new TokenService());
  const { authorizationUrl } = await service.beginAuthorization('user_001', 'threads');
  const state = new URL(authorizationUrl).searchParams.get('state') ?? '';
  const account = await service.completeCallback('threads', { state, code: 'threads-authorization-code' });

  assert.ok('platformAccountId' in account);
  assert.equal(account.platform, 'threads');
  assert.ok(repository.credential);
  assert.equal(repository.credential.platform, 'threads');
  assert.equal(repository.credential.accessTokenEncrypted.includes('threads-access-token-secret'), false);
});
