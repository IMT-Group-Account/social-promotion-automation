import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurableOAuthProvider } from './configurable-oauth.provider';
import type { OAuthIdentity } from './oauth.types';

/** OAuth identity and token boundary for Threads only; it is not a Meta Page credential. */
@Injectable()
export class ThreadsOAuthProvider extends ConfigurableOAuthProvider {
  readonly platform = 'threads' as const;
  readonly callbackRoute = 'threads' as const;
  protected readonly envPrefix = 'THREADS';

  protected identityFromProfile(profile: Record<string, unknown>): OAuthIdentity {
    const platformAccountId = this.string(profile.id) ?? this.string(profile.user_id);
    if (!platformAccountId) throw new ServiceUnavailableException('Threads profile omitted a user ID.');
    return { platformAccountId, accountName: this.string(profile.username) ?? this.string(profile.name) };
  }
}
