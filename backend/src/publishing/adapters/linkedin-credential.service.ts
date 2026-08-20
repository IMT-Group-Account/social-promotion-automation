import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from '../../auth/oauth-account.repository';
import { TokenService } from '../../auth/token.service';

export interface LinkedInPublishingCredential {
  socialAccountId: string;
  authorUrn: string;
  accessToken: string;
  scope: ReadonlySet<string>;
}

export interface LinkedInCredentialResolver {
  resolve(socialAccountId: string): Promise<LinkedInPublishingCredential>;
}

export const LINKEDIN_CREDENTIAL_RESOLVER = Symbol('LINKEDIN_CREDENTIAL_RESOLVER');

@Injectable()
export class LinkedInCredentialService implements LinkedInCredentialResolver {
  constructor(
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
    private readonly tokens: TokenService,
  ) {}

  async resolve(socialAccountId: string): Promise<LinkedInPublishingCredential> {
    const account = await this.accounts.findActiveSocialAccount(socialAccountId, 'linkedin');
    if (!account) throw new NotFoundException('An active LinkedIn account was not found.');
    if (account.expiresAt && account.expiresAt <= new Date()) throw new ForbiddenException('The LinkedIn access token has expired and must be reconnected.');
    if (!/^urn:li:(organization|person):[^:]+$/.test(account.platformAccountId)) {
      throw new ForbiddenException('LinkedIn publishing requires a verified person or organization author URN.');
    }
    return {
      socialAccountId: account.id, authorUrn: account.platformAccountId,
      accessToken: this.tokens.decrypt(account.accessTokenEncrypted), scope: new Set(account.scope),
    };
  }
}
