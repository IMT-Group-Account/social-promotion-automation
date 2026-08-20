import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurableOAuthProvider } from './configurable-oauth.provider';
import type { FacebookManagedPage, OAuthIdentity } from './oauth.types';

@Injectable()
export class FacebookOAuthProvider extends ConfigurableOAuthProvider {
  readonly platform = 'facebook' as const;
  readonly callbackRoute = 'meta' as const;
  protected readonly envPrefix = 'FACEBOOK';

  protected identityFromProfile(profile: Record<string, unknown>): OAuthIdentity {
    const platformAccountId = this.string(profile.id);
    if (!platformAccountId) throw new ServiceUnavailableException('Meta profile omitted an account ID.');
    return { platformAccountId, accountName: this.string(profile.name) };
  }

  async listManagedPages(accessToken: string): Promise<readonly FacebookManagedPage[]> {
    const url = new URL(this.required('MANAGED_PAGES_URL'));
    url.searchParams.set('fields', 'id,name,access_token');
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new ServiceUnavailableException(`Meta managed Page lookup failed (${response.status}).`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ServiceUnavailableException('Meta managed Page response is invalid.');
    const data = (payload as Record<string, unknown>).data;
    if (!Array.isArray(data)) throw new ServiceUnavailableException('Meta managed Page response omitted data.');
    return data.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new ServiceUnavailableException('Meta managed Page entry is invalid.');
      const item = candidate as Record<string, unknown>;
      const pageId = this.string(item.id);
      const pageName = this.string(item.name);
      const pageAccessToken = this.string(item.access_token);
      if (!pageId || !pageName || !pageAccessToken) throw new ServiceUnavailableException('Meta managed Page entry omitted required fields.');
      return { pageId, pageName, pageAccessToken };
    });
  }
}
