export const OAUTH_PLATFORMS = ['linkedin', 'facebook', 'threads', 'x'] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];
export type SocialAccountPlatform = OAuthPlatform | 'instagram';
export type OAuthCallbackRoute = 'linkedin' | 'meta' | 'threads' | 'x';

export interface OAuthAuthorizationState {
  stateHash: string;
  userId: string;
  platform: OAuthPlatform;
  callbackRoute: OAuthCallbackRoute;
  codeVerifierEncrypted: string;
  expiresAt: Date;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: readonly string[];
}

export interface OAuthIdentity { platformAccountId: string; accountName: string | null; }

export interface SocialAccountCredential {
  userId: string;
  platform: SocialAccountPlatform;
  platformAccountId: string;
  accountName: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope: readonly string[];
  tokenKeyVersion: string;
}

export interface ConnectedSocialAccount {
  id: string;
  userId: string;
  platform: SocialAccountPlatform;
  platformAccountId: string;
  accountName: string | null;
  expiresAt: Date | null;
  scope: readonly string[];
  status: 'active' | 'expired' | 'revoked' | 'disabled';
}

/** Server-only record used by publishing adapters; never serialize this type to an HTTP response. */
export interface ActiveSocialAccountCredential {
  id: string;
  platform: SocialAccountPlatform;
  platformAccountId: string;
  accessTokenEncrypted: string;
  expiresAt: Date | null;
  scope: readonly string[];
  status: 'active';
}

export interface FacebookManagedPage { pageId: string; pageName: string; pageAccessToken: string; }
export interface FacebookPageSelection { selectionId: string; pages: readonly { pageId: string; pageName: string }[]; }
export interface FacebookPageSelectionRecord {
  userId: string;
  scope: readonly string[];
  pageId: string;
  pageName: string;
  pageAccessTokenEncrypted: string;
}
