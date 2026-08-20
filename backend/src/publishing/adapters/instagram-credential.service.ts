import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from '../../auth/oauth-account.repository';
import { TokenService } from '../../auth/token.service';

export interface InstagramPublishingCredential { socialAccountId: string; instagramAccountId: string; accessToken: string; scope: ReadonlySet<string>; }
export interface InstagramCredentialResolver { resolve(socialAccountId: string): Promise<InstagramPublishingCredential>; }
export const INSTAGRAM_CREDENTIAL_RESOLVER = Symbol('INSTAGRAM_CREDENTIAL_RESOLVER');

@Injectable()
export class InstagramCredentialService implements InstagramCredentialResolver {
  constructor(@Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository, private readonly tokens: TokenService) {}

  async resolve(socialAccountId: string): Promise<InstagramPublishingCredential> {
    const account = await this.accounts.findActiveSocialAccount(socialAccountId, 'instagram');
    if (!account) throw new NotFoundException('An active Instagram professional account was not found.');
    if (account.expiresAt && account.expiresAt <= new Date()) throw new ForbiddenException('The Instagram access token has expired and must be reconnected.');
    if (!/^\d+$/.test(account.platformAccountId)) throw new ForbiddenException('Instagram publishing requires a verified professional account ID.');
    return { socialAccountId: account.id, instagramAccountId: account.platformAccountId, accessToken: this.tokens.decrypt(account.accessTokenEncrypted), scope: new Set(account.scope) };
  }
}
