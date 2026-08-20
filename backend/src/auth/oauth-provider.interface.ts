import type { FacebookManagedPage, OAuthCallbackRoute, OAuthIdentity, OAuthPlatform, OAuthTokenSet } from './oauth.types';

export interface OAuthProvider {
  readonly platform: OAuthPlatform;
  readonly callbackRoute: OAuthCallbackRoute;
  createAuthorizationUrl(input: { state: string; codeChallenge: string }): URL;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet>;
  fetchIdentity(accessToken: string): Promise<OAuthIdentity>;
  listManagedPages?(accessToken: string): Promise<readonly FacebookManagedPage[]>;
}

export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
