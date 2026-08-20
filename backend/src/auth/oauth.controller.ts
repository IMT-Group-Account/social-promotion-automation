import { Controller, Get, Query } from '@nestjs/common';
import { OauthService } from './oauth.service';

@Controller('oauth')
export class OauthController {
  constructor(private readonly oauth: OauthService) {}

  @Get('linkedin/callback') linkedInCallback(@Query() query: { state?: string; code?: string; error?: string }) {
    return this.oauth.completeCallback('linkedin', query);
  }

  @Get('meta/callback') metaCallback(@Query() query: { state?: string; code?: string; error?: string }) {
    return this.oauth.completeCallback('meta', query);
  }

  @Get('threads/callback') threadsCallback(@Query() query: { state?: string; code?: string; error?: string }) {
    return this.oauth.completeCallback('threads', query);
  }

  @Get('x/callback') xCallback(@Query() query: { state?: string; code?: string; error?: string }) {
    return this.oauth.completeCallback('x', query);
  }

}
