import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { OAUTH_ACCOUNT_REPOSITORY, type OAuthAccountRepository } from './oauth-account.repository';
import { OauthService } from './oauth.service';
import type { OAuthPlatform, SocialAccountPlatform } from './oauth.types';

interface AuthenticatedRequest { user?: { id?: string }; }
interface SelectFacebookPageDto { selectionId: string; pageId: string; }

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly oauth: OauthService,
    @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository,
  ) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return { data: await this.accounts.listSocialAccounts(this.userId(request)), error: null, meta: {} };
  }

  @Post('linkedin/connect') connectLinkedIn(@Req() request: AuthenticatedRequest) { return this.connect(request, 'linkedin'); }
  @Post('facebook/connect') connectFacebook(@Req() request: AuthenticatedRequest) { return this.connect(request, 'facebook'); }
  @Post('instagram/connect') connectInstagram(@Req() request: AuthenticatedRequest) { return this.connect(request, 'instagram'); }
  @Post('threads/connect') connectThreads(@Req() request: AuthenticatedRequest) { return this.connect(request, 'threads'); }
  @Post('x/connect') connectX(@Req() request: AuthenticatedRequest) { return this.connect(request, 'x'); }

  @Post('facebook/pages/select')
  async selectFacebookPage(@Req() request: AuthenticatedRequest, @Body() dto: SelectFacebookPageDto) {
    return { data: await this.oauth.selectFacebookPage(this.userId(request), dto.selectionId, dto.pageId), error: null, meta: {} };
  }

  @Delete(':integrationId')
  async disconnect(@Req() request: AuthenticatedRequest, @Param('integrationId') integrationId: string) {
    const disconnected = await this.accounts.disconnectSocialAccount(this.userId(request), integrationId);
    if (!disconnected) throw new NotFoundException('Integration not found.');
    return { data: { id: integrationId, disconnected }, error: null, meta: {} };
  }

  private async connect(request: AuthenticatedRequest, platform: SocialAccountPlatform) {
    // Instagram authorization is performed by the Meta OAuth provider; it still
    // has its own Adapter and persisted Instagram account identity afterwards.
    const oauthPlatform: OAuthPlatform = platform === 'instagram' ? 'facebook' : platform;
    const { authorizationUrl } = await this.oauth.beginAuthorization(this.userId(request), oauthPlatform);
    return { data: { platform, authorizationUrl }, error: null, meta: { provider: oauthPlatform } };
  }

  private userId(request: AuthenticatedRequest): string {
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException('An authenticated user context is required.');
    return userId;
  }
}
