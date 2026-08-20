import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from '../../auth/oauth-account.repository';
import { TokenService } from '../../auth/token.service';

export interface FacebookPageCredential { socialAccountId: string; pageId: string; accessToken: string; scope: ReadonlySet<string>; }
export interface FacebookCredentialResolver { resolve(socialAccountId: string): Promise<FacebookPageCredential>; }
export const FACEBOOK_CREDENTIAL_RESOLVER = Symbol('FACEBOOK_CREDENTIAL_RESOLVER');

@Injectable()
export class FacebookCredentialService implements FacebookCredentialResolver {
  constructor(
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
    private readonly tokens: TokenService,
  ) {}

  async resolve(socialAccountId: string): Promise<FacebookPageCredential> {
    const account = await this.accounts.findActiveSocialAccount(socialAccountId, 'facebook');
    if (!account) throw new NotFoundException('An active Facebook Page account was not found.');
    if (account.expiresAt && account.expiresAt <= new Date()) throw new ForbiddenException('The Facebook Page access token has expired and must be reconnected.');
    if (!/^\d+$/.test(account.platformAccountId)) throw new ForbiddenException('Facebook publishing requires a verified numeric Page ID.');
    return { socialAccountId: account.id, pageId: account.platformAccountId, accessToken: this.tokens.decrypt(account.accessTokenEncrypted), scope: new Set(account.scope) };
  }
}
