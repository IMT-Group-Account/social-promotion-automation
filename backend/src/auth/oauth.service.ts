import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from './oauth-account.repository';
import { OAUTH_PROVIDERS, type OAuthProvider } from './oauth-provider.interface';
import { TokenService } from './token.service';
import type { ConnectedSocialAccount, FacebookPageSelection, OAuthCallbackRoute, OAuthPlatform } from './oauth.types';

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class OauthService {
  private readonly providersByPlatform: ReadonlyMap<OAuthPlatform, OAuthProvider>;

  constructor(
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly repository: OAuthAccountRepository,
    @Inject(OAUTH_PROVIDERS) providers: readonly OAuthProvider[],
    private readonly tokens: TokenService,
  ) {
    this.providersByPlatform = new Map(providers.map((provider) => [provider.platform, provider]));
  }

  async beginAuthorization(userId: string, platform: OAuthPlatform): Promise<{ authorizationUrl: string }> {
    if (!userId?.trim()) throw new UnauthorizedException('An authenticated user context is required.');
    const provider = this.provider(platform);
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    await this.repository.createState({
      stateHash: this.hashState(state), userId, platform, callbackRoute: provider.callbackRoute,
      codeVerifierEncrypted: this.tokens.encrypt(codeVerifier), expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    return { authorizationUrl: provider.createAuthorizationUrl({ state, codeChallenge }).toString() };
  }

  async completeCallback(
    callbackRoute: OAuthCallbackRoute,
    query: { state?: string; code?: string; error?: string },
  ): Promise<ConnectedSocialAccount | FacebookPageSelection> {
    if (!query.state) throw new UnauthorizedException('OAuth state is missing.');
    const state = await this.repository.consumeState(this.hashState(query.state));
    if (!state || state.callbackRoute !== callbackRoute) throw new UnauthorizedException('OAuth state is invalid, expired, or already used.');
    if (query.error) throw new BadRequestException('The social account authorization was not approved.');
    if (!query.code) throw new BadRequestException('OAuth authorization code is missing.');

    const provider = this.provider(state.platform);
    const tokenSet = await provider.exchangeCode({ code: query.code, codeVerifier: this.tokens.decrypt(state.codeVerifierEncrypted) });
    if (state.platform === 'facebook') {
      if (!provider.listManagedPages) throw new BadRequestException('Facebook Page selection is not supported by the configured provider.');
      const pages = await provider.listManagedPages(tokenSet.accessToken);
      if (pages.length === 0) throw new BadRequestException('No manageable Facebook Pages were returned.');
      const selectionId = randomBytes(32).toString('base64url');
      await this.repository.createFacebookPageSelection({
        selectionHash: this.hashState(selectionId), userId: state.userId, scope: tokenSet.scopes, expiresAt: new Date(Date.now() + STATE_TTL_MS),
        pages: pages.map((page) => ({ pageId: page.pageId, pageName: page.pageName, pageAccessTokenEncrypted: this.tokens.encrypt(page.pageAccessToken) })),
      });
      return { selectionId, pages: pages.map(({ pageId, pageName }) => ({ pageId, pageName })) };
    }
    const identity = await provider.fetchIdentity(tokenSet.accessToken);
    return this.repository.upsertSocialAccount({
      userId: state.userId, platform: state.platform, platformAccountId: identity.platformAccountId, accountName: identity.accountName,
      accessTokenEncrypted: this.tokens.encrypt(tokenSet.accessToken),
      refreshTokenEncrypted: tokenSet.refreshToken ? this.tokens.encrypt(tokenSet.refreshToken) : null,
      expiresAt: tokenSet.expiresAt, scope: tokenSet.scopes, tokenKeyVersion: this.tokens.keyVersion(),
    });
  }

  async selectFacebookPage(userId: string, selectionId: string, pageId: string): Promise<ConnectedSocialAccount> {
    if (!userId?.trim()) throw new UnauthorizedException('An authenticated user context is required.');
    if (!selectionId || !pageId) throw new BadRequestException('Facebook Page selection is incomplete.');
    const selected = await this.repository.consumeFacebookPageSelection(this.hashState(selectionId), userId, pageId);
    if (!selected) throw new UnauthorizedException('Facebook Page selection is invalid, expired, or already used.');
    return this.repository.upsertSocialAccount({
      userId: selected.userId, platform: 'facebook', platformAccountId: selected.pageId, accountName: selected.pageName,
      accessTokenEncrypted: selected.pageAccessTokenEncrypted, refreshTokenEncrypted: null, expiresAt: null,
      scope: selected.scope, tokenKeyVersion: this.tokens.keyVersion(),
    });
  }

  private provider(platform: OAuthPlatform): OAuthProvider {
    const provider = this.providersByPlatform.get(platform);
    if (!provider) throw new BadRequestException(`Unsupported OAuth platform: ${platform}.`);
    return provider;
  }

  private hashState(state: string): string { return createHash('sha256').update(state).digest('hex'); }
}
