import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurableOAuthProvider } from './configurable-oauth.provider';
import type { OAuthIdentity } from './oauth.types';

@Injectable()
export class XOAuthProvider extends ConfigurableOAuthProvider {
  readonly platform = 'x' as const;
  readonly callbackRoute = 'x' as const;
  protected readonly envPrefix = 'X';

  protected identityFromProfile(profile: Record<string, unknown>): OAuthIdentity {
    const data = profile.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ServiceUnavailableException('X profile response is invalid.');
    const record = data as Record<string, unknown>;
    const platformAccountId = this.string(record.id);
    if (!platformAccountId) throw new ServiceUnavailableException('X profile omitted an account ID.');
    return { platformAccountId, accountName: this.string(record.name) ?? this.string(record.username) };
  }
}
