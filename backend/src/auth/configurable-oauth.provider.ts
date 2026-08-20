import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { OAuthProvider } from './oauth-provider.interface';
import type { OAuthIdentity, OAuthTokenSet } from './oauth.types';

type JsonObject = Record<string, unknown>;

@Injectable()
export abstract class ConfigurableOAuthProvider implements OAuthProvider {
  abstract readonly platform: OAuthProvider['platform'];
  abstract readonly callbackRoute: OAuthProvider['callbackRoute'];
  protected abstract readonly envPrefix: string;
  protected abstract identityFromProfile(profile: JsonObject): OAuthIdentity;

  createAuthorizationUrl(input: { state: string; codeChallenge: string }): URL {
    const url = new URL(this.required('AUTHORIZATION_URL'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.required('CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', this.required('SCOPES'));
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url;
  }

  async exchangeCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: input.code, redirect_uri: this.callbackUrl(),
      client_id: this.required('CLIENT_ID'), client_secret: this.required('CLIENT_SECRET'), code_verifier: input.codeVerifier,
    });
    const response = await fetch(this.required('TOKEN_URL'), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body,
    });
    if (!response.ok) throw new ServiceUnavailableException(`${this.platform} token exchange failed (${response.status}).`);
    const payload = await this.json(response);
    const accessToken = this.string(payload.access_token);
    if (!accessToken) throw new ServiceUnavailableException(`${this.platform} token response omitted an access token.`);
    const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : null;
    const returnedScope = this.string(payload.scope);
    return {
      accessToken, refreshToken: this.string(payload.refresh_token), expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
      scopes: (returnedScope ?? this.required('SCOPES')).split(/[ ,]+/).filter(Boolean),
    };
  }

  async fetchIdentity(accessToken: string): Promise<OAuthIdentity> {
    const response = await fetch(this.required('PROFILE_URL'), { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new ServiceUnavailableException(`${this.platform} profile lookup failed (${response.status}).`);
    return this.identityFromProfile(await this.json(response));
  }

  protected required(name: string): string {
    const value = process.env[`OAUTH_${this.envPrefix}_${name}`];
    if (!value) throw new ServiceUnavailableException(`OAuth provider ${this.platform} is not configured.`);
    return value;
  }

  private callbackUrl(): string {
    const origin = process.env.PUBLIC_API_ORIGIN;
    if (!origin) throw new ServiceUnavailableException('PUBLIC_API_ORIGIN is not configured.');
    try { return new URL(`/api/oauth/${this.callbackRoute}/callback`, origin).toString(); }
    catch { throw new ServiceUnavailableException('PUBLIC_API_ORIGIN must be a valid URL.'); }
  }

  private async json(response: Response): Promise<JsonObject> {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ServiceUnavailableException(`${this.platform} returned an invalid JSON response.`);
    return payload as JsonObject;
  }

  protected string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
}
