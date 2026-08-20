import assert from 'node:assert/strict';
import test from 'node:test';
import { OauthService } from '../src/auth/oauth.service';
import type { OAuthAccountRepository } from '../src/auth/oauth-account.repository';
import type { OAuthProvider } from '../src/auth/oauth-provider.interface';
import { TokenService } from '../src/auth/token.service';
import type { ActiveSocialAccountCredential, ConnectedSocialAccount, FacebookPageSelectionRecord, OAuthAuthorizationState, SocialAccountCredential } from '../src/auth/oauth.types';

process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION = 'facebook-test-v1';

class FacebookSelectionRepository implements OAuthAccountRepository {
  private state: OAuthAuthorizationState | undefined;
  private selection: { hash: string; userId: string; scope: readonly string[]; pages: readonly { pageId: string; pageName: string; pageAccessTokenEncrypted: string }[] } | undefined;
  saved: SocialAccountCredential | undefined;
  async createState(state: OAuthAuthorizationState): Promise<void> { this.state = state; }
  async consumeState(hash: string): Promise<OAuthAuthorizationState | null> { if (this.state?.stateHash !== hash) return null; const state = this.state; this.state = undefined; return state; }
  async upsertSocialAccount(credential: SocialAccountCredential): Promise<ConnectedSocialAccount> {
    this.saved = credential;
    return { id: 'facebook-account-001', userId: credential.userId, platform: credential.platform, platformAccountId: credential.platformAccountId, accountName: credential.accountName, expiresAt: credential.expiresAt, scope: credential.scope, status: 'active' };
  }
  async findActiveSocialAccount(): Promise<ActiveSocialAccountCredential | null> { return null; }
  async listSocialAccounts() { return []; }
  async disconnectSocialAccount() { return false; }
  async createFacebookPageSelection(input: { selectionHash: string; userId: string; scope: readonly string[]; expiresAt: Date; pages: readonly { pageId: string; pageName: string; pageAccessTokenEncrypted: string }[] }): Promise<void> {
    this.selection = { hash: input.selectionHash, userId: input.userId, scope: input.scope, pages: input.pages };
  }
  async consumeFacebookPageSelection(hash: string, userId: string, pageId: string): Promise<FacebookPageSelectionRecord | null> {
    if (!this.selection || this.selection.hash !== hash || this.selection.userId !== userId) return null;
    const page = this.selection.pages.find((candidate) => candidate.pageId === pageId);
    this.selection = undefined;
    return page ? { userId, scope: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'], pageId: page.pageId, pageName: page.pageName, pageAccessTokenEncrypted: page.pageAccessTokenEncrypted } : null;
  }
}

class TestFacebookProvider implements OAuthProvider {
  readonly platform = 'facebook' as const;
  readonly callbackRoute = 'meta' as const;
  createAuthorizationUrl(input: { state: string; codeChallenge: string }): URL { return new URL(`https://oauth.example/facebook?state=${input.state}`); }
  async exchangeCode() { return { accessToken: 'user-token-not-stored', refreshToken: null, expiresAt: null, scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] }; }
  async fetchIdentity() { return { platformAccountId: 'unused', accountName: null }; }
  async listManagedPages() { return [{ pageId: '123456789', pageName: 'Campaign Foundation', pageAccessToken: 'page-token-secret' }]; }
}

test('Facebook OAuth stores a Page token only after authenticated Page selection', async () => {
  const repository = new FacebookSelectionRepository();
  const service = new OauthService(repository, [new TestFacebookProvider()], new TokenService());
  const start = await service.beginAuthorization('user_001', 'facebook');
  const state = new URL(start.authorizationUrl).searchParams.get('state') ?? '';
  const callback = await service.completeCallback('meta', { state, code: 'facebook-code' });
  assert.ok('selectionId' in callback);
  assert.deepEqual(callback.pages, [{ pageId: '123456789', pageName: 'Campaign Foundation' }]);
  assert.equal(JSON.stringify(callback).includes('page-token-secret'), false);

  const account = await service.selectFacebookPage('user_001', callback.selectionId, '123456789');
  assert.equal(account.platformAccountId, '123456789');
  assert.equal(repository.saved?.accessTokenEncrypted.includes('page-token-secret'), false);
  assert.equal(new TokenService().decrypt(repository.saved?.accessTokenEncrypted ?? ''), 'page-token-secret');
});
