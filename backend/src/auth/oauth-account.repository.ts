import type { ActiveSocialAccountCredential, ConnectedSocialAccount, FacebookPageSelectionRecord, OAuthAuthorizationState, SocialAccountCredential } from './oauth.types';

export const OAUTH_ACCOUNT_REPOSITORY = Symbol('OAUTH_ACCOUNT_REPOSITORY');

export interface OAuthAccountRepository {
  createState(state: OAuthAuthorizationState): Promise<void>;
  consumeState(stateHash: string): Promise<OAuthAuthorizationState | null>;
  upsertSocialAccount(credential: SocialAccountCredential): Promise<ConnectedSocialAccount>;
  findActiveSocialAccount(id: string, platform: ActiveSocialAccountCredential['platform']): Promise<ActiveSocialAccountCredential | null>;
  listSocialAccounts(userId: string): Promise<readonly ConnectedSocialAccount[]>;
  disconnectSocialAccount(userId: string, accountId: string): Promise<boolean>;
  createFacebookPageSelection(input: { selectionHash: string; userId: string; scope: readonly string[]; expiresAt: Date; pages: readonly { pageId: string; pageName: string; pageAccessTokenEncrypted: string }[] }): Promise<void>;
  consumeFacebookPageSelection(selectionHash: string, userId: string, pageId: string): Promise<FacebookPageSelectionRecord | null>;
}
