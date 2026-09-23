import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { SelectFacebookPageDto } from './integrations.dto';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from './oauth-account.repository';
import { OauthService } from './oauth.service';
import type { OAuthPlatform, SocialAccountPlatform } from './oauth.types';
import { missingPublishingScopes } from '../publishing/publishing-permissions';
import { RequireRoles } from './roles.decorator';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly oauth: OauthService,
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
  ) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const accounts = await this.accounts.listSocialAccounts(request.user!.id);
    return { data: accounts.map(a=>({...a,status:a.status==='active'&&a.expiresAt&&a.expiresAt<=new Date()?'expired':a.status,
      missingScopes:missingPublishingScopes(a.platform,a.scope,a.platformAccountId)})), error: null, meta: {} };
  }

  @Post('linkedin/connect') @RequireRoles('admin') connectLinkedIn(@Req() request: AuthenticatedRequest) { return this.connect(request, 'linkedin'); }
  @Post('facebook/connect') @RequireRoles('admin') connectFacebook(@Req() request: AuthenticatedRequest) { return this.connect(request, 'facebook'); }
  @Post('instagram/connect') @RequireRoles('admin') connectInstagram(@Req() request: AuthenticatedRequest) { return this.connect(request, 'instagram'); }
  @Post('threads/connect') @RequireRoles('admin') connectThreads(@Req() request: AuthenticatedRequest) { return this.connect(request, 'threads'); }
  @Post('x/connect') @RequireRoles('admin') connectX(@Req() request: AuthenticatedRequest) { return this.connect(request, 'x'); }

  @Post('facebook/pages/select')
  @RequireRoles('admin')
  async selectFacebookPage(@Req() request: AuthenticatedRequest, @Body() dto: SelectFacebookPageDto) {
    return { data: await this.oauth.selectFacebookPage(request.user!.id, dto.selectionId, dto.pageId, dto.platform), error: null, meta: {} };
  }

  @Delete(':integrationId')
  @RequireRoles('admin')
  async disconnect(@Req() request: AuthenticatedRequest, @Param('integrationId') integrationId: string) {
    const disconnected = await this.accounts.disconnectSocialAccount(request.user!.id, integrationId);
    if (!disconnected) throw new NotFoundException('Integration not found.');
    return { data: { id: integrationId, disconnected }, error: null, meta: {} };
  }

  private async connect(request: AuthenticatedRequest, platform: SocialAccountPlatform) {
    // Instagram authorization is performed by the Meta OAuth provider; it still
    // has its own Adapter and persisted Instagram account identity afterwards.
    const oauthPlatform: OAuthPlatform = platform === 'instagram' ? 'facebook' : platform;
    const { authorizationUrl } = await this.oauth.beginAuthorization(request.user!.id, oauthPlatform);
    return { data: { platform, authorizationUrl }, error: null, meta: { provider: oauthPlatform } };
  }
}
