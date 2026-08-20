import { Module } from '@nestjs/common';
import { FacebookOAuthProvider } from './facebook-oauth.provider';
import { LinkedInOAuthProvider } from './linkedin-oauth.provider';
import { OAUTH_ACCOUNT_REPOSITORY } from './oauth-account.repository';
import { OauthController } from './oauth.controller';
import { IntegrationsController } from './integrations.controller';
import { OAUTH_PROVIDERS } from './oauth-provider.interface';
import { OauthService } from './oauth.service';
import { PgOAuthAccountRepository } from './pg-oauth-account.repository';
import { TokenService } from './token.service';
import { ThreadsOAuthProvider } from './threads-oauth.provider';
import { XOAuthProvider } from './x-oauth.provider';

@Module({
  controllers: [OauthController, IntegrationsController],
  providers: [
    OauthService, TokenService, PgOAuthAccountRepository, LinkedInOAuthProvider, FacebookOAuthProvider, ThreadsOAuthProvider, XOAuthProvider,
    { provide: OAUTH_ACCOUNT_REPOSITORY, useExisting: PgOAuthAccountRepository },
    {
      provide: OAUTH_PROVIDERS,
      useFactory: (linkedin: LinkedInOAuthProvider, facebook: FacebookOAuthProvider, threads: ThreadsOAuthProvider, x: XOAuthProvider) => [linkedin, facebook, threads, x],
      inject: [LinkedInOAuthProvider, FacebookOAuthProvider, ThreadsOAuthProvider, XOAuthProvider],
    },
  ],
  exports: [OauthService, TokenService, OAUTH_ACCOUNT_REPOSITORY],
})
export class AuthModule {}
