import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from '../../auth/oauth-account.repository';
import { TokenService } from '../../auth/token.service';

export interface XPublishingCredential {
  socialAccountId: string;
  xUserId: string;
  accessToken: string;
  scope: ReadonlySet<string>;
}

export interface XCredentialResolver { resolve(socialAccountId: string): Promise<XPublishingCredential>; }
export const X_CREDENTIAL_RESOLVER = Symbol('X_CREDENTIAL_RESOLVER');

@Injectable()
export class XCredentialService implements XCredentialResolver {
  constructor(
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
    private readonly tokens: TokenService,
  ) {}

  async resolve(socialAccountId: string): Promise<XPublishingCredential> {
    const account = await this.accounts.findActiveSocialAccount(socialAccountId, 'x');
    if (!account) throw new NotFoundException('An active X account was not found.');
    if (account.expiresAt && account.expiresAt <= new Date()) throw new ForbiddenException('The X access token has expired and must be reconnected.');
    if (!/^\d+$/.test(account.platformAccountId)) throw new ForbiddenException('X publishing requires a verified numeric user ID.');
    return {
      socialAccountId: account.id,
      xUserId: account.platformAccountId,
      accessToken: this.tokens.decrypt(account.accessTokenEncrypted),
      scope: new Set(account.scope),
    };
  }
}
