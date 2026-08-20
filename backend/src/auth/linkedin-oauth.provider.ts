import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurableOAuthProvider } from './configurable-oauth.provider';
import type { OAuthIdentity } from './oauth.types';

@Injectable()
export class LinkedInOAuthProvider extends ConfigurableOAuthProvider {
  readonly platform = 'linkedin' as const;
  readonly callbackRoute = 'linkedin' as const;
  protected readonly envPrefix = 'LINKEDIN';

  protected identityFromProfile(profile: Record<string, unknown>): OAuthIdentity {
    const platformAccountId = this.string(profile.sub) ?? this.string(profile.id);
    if (!platformAccountId) throw new ServiceUnavailableException('LinkedIn profile omitted an account ID.');
    return { platformAccountId, accountName: this.string(profile.name) ?? this.string(profile.localizedFirstName) };
  }
}
