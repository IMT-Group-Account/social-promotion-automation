import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from '../../auth/oauth-account.repository';
import { TokenService } from '../../auth/token.service';

export interface ThreadsPublishingCredential {
  socialAccountId: string;
  threadsUserId: string;
  accessToken: string;
  scope: ReadonlySet<string>;
}

export interface ThreadsCredentialResolver {
  resolve(socialAccountId: string): Promise<ThreadsPublishingCredential>;
}

export const THREADS_CREDENTIAL_RESOLVER = Symbol('THREADS_CREDENTIAL_RESOLVER');

/** Resolves only an encrypted Threads user token; Meta Page/Instagram credentials are never accepted here. */
@Injectable()
export class ThreadsCredentialService implements ThreadsCredentialResolver {
  constructor(
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
    private readonly tokens: TokenService,
  ) {}

  async resolve(socialAccountId: string): Promise<ThreadsPublishingCredential> {
    const account = await this.accounts.findActiveSocialAccount(socialAccountId, 'threads');
    if (!account) throw new NotFoundException('An active Threads account was not found.');
    if (account.expiresAt && account.expiresAt <= new Date()) throw new ForbiddenException('The Threads access token has expired and must be reconnected.');
    if (!/^\d+$/.test(account.platformAccountId)) throw new ForbiddenException('Threads publishing requires a verified Threads user ID.');
    return {
      socialAccountId: account.id,
      threadsUserId: account.platformAccountId,
      accessToken: this.tokens.decrypt(account.accessTokenEncrypted),
      scope: new Set(account.scope),
    };
  }
}
