import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import type { OAuthAccountRepository } from './oauth-account.repository';
import type { ActiveSocialAccountCredential, ConnectedSocialAccount, FacebookPageSelectionRecord, OAuthAuthorizationState, SocialAccountCredential } from './oauth.types';

@Injectable()
export class PgOAuthAccountRepository implements OAuthAccountRepository {
  private pool: Pool | undefined;

  async createState(state: OAuthAuthorizationState): Promise<void> {
    await this.db().query(
      `INSERT INTO oauth_states (state_hash, user_id, platform, callback_route, code_verifier_encrypted, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [state.stateHash, state.userId, state.platform, state.callbackRoute, state.codeVerifierEncrypted, state.expiresAt],
    );
  }

  async consumeState(stateHash: string): Promise<OAuthAuthorizationState | null> {
    const result = await this.db().query<{
      state_hash: string; user_id: string; platform: OAuthAuthorizationState['platform']; callback_route: OAuthAuthorizationState['callbackRoute'];
      code_verifier_encrypted: string; expires_at: Date;
    }>(
      `UPDATE oauth_states
       SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING state_hash, user_id, platform, callback_route, code_verifier_encrypted, expires_at`,
      [stateHash],
    );
    const row = result.rows[0];
    return row ? {
      stateHash: row.state_hash, userId: row.user_id, platform: row.platform, callbackRoute: row.callback_route,
      codeVerifierEncrypted: row.code_verifier_encrypted, expiresAt: row.expires_at,
    } : null;
  }

  async upsertSocialAccount(credential: SocialAccountCredential): Promise<ConnectedSocialAccount> {
    const result = await this.db().query<{
      id: string; user_id: string; platform: ConnectedSocialAccount['platform']; platform_account_id: string; account_name: string | null;
      expires_at: Date | null; scope: string[]; status: ConnectedSocialAccount['status'];
    }>(
      `INSERT INTO social_accounts (
         user_id, platform, platform_account_id, account_name, access_token_encrypted, refresh_token_encrypted, expires_at, scope, token_key_version, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
       ON CONFLICT (user_id, platform, platform_account_id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, social_accounts.refresh_token_encrypted),
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         token_key_version = EXCLUDED.token_key_version,
         status = 'active',
         updated_at = now()
       RETURNING id, user_id, platform, platform_account_id, account_name, expires_at, scope, status`,
      [credential.userId, credential.platform, credential.platformAccountId, credential.accountName, credential.accessTokenEncrypted,
        credential.refreshTokenEncrypted, credential.expiresAt, credential.scope, credential.tokenKeyVersion],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Social account persistence returned no row.');
    const account: ConnectedSocialAccount = {
      id: row.id, userId: row.user_id, platform: row.platform, platformAccountId: row.platform_account_id,
      accountName: row.account_name, expiresAt: row.expires_at, scope: row.scope, status: row.status,
    };
    await this.writeAudit(account.userId, 'social_account.connected', 'social_account', account.id, { platform: account.platform });
    return account;
  }

  async findActiveSocialAccount(id: string, platform: ActiveSocialAccountCredential['platform']): Promise<ActiveSocialAccountCredential | null> {
    const result = await this.db().query<{
      id: string; platform: ActiveSocialAccountCredential['platform']; platform_account_id: string; access_token_encrypted: string;
      expires_at: Date | null; scope: string[];
    }>(
      `SELECT id, platform, platform_account_id, access_token_encrypted, expires_at, scope
       FROM social_accounts
       WHERE id = $1 AND platform = $2 AND status = 'active' AND access_token_encrypted IS NOT NULL`,
      [id, platform],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id, platform: row.platform, platformAccountId: row.platform_account_id, accessTokenEncrypted: row.access_token_encrypted,
      expiresAt: row.expires_at, scope: row.scope, status: 'active',
    } : null;
  }

  async listSocialAccounts(userId: string): Promise<readonly ConnectedSocialAccount[]> {
    const result = await this.db().query<{
      id: string; user_id: string; platform: ConnectedSocialAccount['platform']; platform_account_id: string; account_name: string | null;
      expires_at: Date | null; scope: string[]; status: ConnectedSocialAccount['status'];
    }>(
      `SELECT id, user_id, platform, platform_account_id, account_name, expires_at, scope, status
       FROM social_accounts WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [userId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, platform: row.platform, platformAccountId: row.platform_account_id,
      accountName: row.account_name, expiresAt: row.expires_at, scope: row.scope, status: row.status }));
  }

  async disconnectSocialAccount(userId: string, accountId: string): Promise<boolean> {
    const result = await this.db().query(
      `UPDATE social_accounts
       SET status = 'revoked', access_token_encrypted = NULL, refresh_token_encrypted = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status <> 'revoked'`,
      [accountId, userId],
    );
    const disconnected = (result.rowCount ?? 0) === 1;
    if (disconnected) await this.writeAudit(userId, 'social_account.disconnected', 'social_account', accountId, {});
    return disconnected;
  }

  async createFacebookPageSelection(input: { selectionHash: string; userId: string; scope: readonly string[]; expiresAt: Date; pages: readonly { pageId: string; pageName: string; pageAccessTokenEncrypted: string }[] }): Promise<void> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO facebook_page_selections (selection_hash, user_id, scope, expires_at) VALUES ($1, $2, $3, $4)`,
        [input.selectionHash, input.userId, input.scope, input.expiresAt],
      );
      for (const page of input.pages) {
        await client.query(
          `INSERT INTO facebook_page_selection_items (selection_hash, page_id, page_name, page_access_token_encrypted) VALUES ($1, $2, $3, $4)`,
          [input.selectionHash, page.pageId, page.pageName, page.pageAccessTokenEncrypted],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async consumeFacebookPageSelection(selectionHash: string, userId: string, pageId: string): Promise<FacebookPageSelectionRecord | null> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const selection = await client.query<{ scope: string[] }>(
        `UPDATE facebook_page_selections SET consumed_at = now()
         WHERE selection_hash = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > now()
         RETURNING scope`, [selectionHash, userId],
      );
      if (!selection.rows[0]) { await client.query('ROLLBACK'); return null; }
      const page = await client.query<{ page_id: string; page_name: string; page_access_token_encrypted: string }>(
        `SELECT page_id, page_name, page_access_token_encrypted FROM facebook_page_selection_items WHERE selection_hash = $1 AND page_id = $2`,
        [selectionHash, pageId],
      );
      if (!page.rows[0]) { await client.query('ROLLBACK'); return null; }
      await client.query('COMMIT');
      return { userId, scope: selection.rows[0].scope, pageId: page.rows[0].page_id, pageName: page.rows[0].page_name, pageAccessTokenEncrypted: page.rows[0].page_access_token_encrypted };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private db(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('OAuth database persistence is not configured.');
    this.pool = new Pool({ connectionString, max: 5 });
    return this.pool;
  }

  private async writeAudit(userId: string, action: string, entityType: string, entityId: string, metadata: Readonly<Record<string, string>>): Promise<void> {
    await this.db().query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }
}
