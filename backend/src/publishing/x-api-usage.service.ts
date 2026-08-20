import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

export type XUsageOperation = 'post_create' | 'post_create_with_url' | 'media_upload' | 'post_read' | 'post_delete';
export type XUsageOutcome = 'reserved' | 'succeeded' | 'failed';

export interface XUsageReservation {
  id: string;
  operation: XUsageOperation;
  estimatedCostMicrousd: number;
}

export interface XUsageLedger {
  reserve(input: { socialAccountId: string; operation: XUsageOperation; estimatedCostMicrousd: number; pricingVersion: string }): Promise<XUsageReservation>;
  settle(id: string, outcome: Exclude<XUsageOutcome, 'reserved'>, externalReference?: string): Promise<void>;
}

export const X_USAGE_LEDGER = Symbol('X_USAGE_LEDGER');

/**
 * Uses integer micro-USD values so cost estimates never use floating point.
 * A reservation is recorded before an outbound request; reconciliation with the
 * X Developer Console remains the source of truth for actual billed credits.
 */
@Injectable()
export class PgXUsageLedger implements XUsageLedger {
  private pool: Pool | undefined;

  async reserve(input: { socialAccountId: string; operation: XUsageOperation; estimatedCostMicrousd: number; pricingVersion: string }): Promise<XUsageReservation> {
    const result = await this.db().query<{ id: string }>(
      `INSERT INTO x_api_usage_ledger (social_account_id, operation, estimated_cost_microusd, pricing_version, outcome)
       VALUES ($1, $2, $3, $4, 'reserved') RETURNING id`,
      [input.socialAccountId, input.operation, input.estimatedCostMicrousd, input.pricingVersion],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new ServiceUnavailableException('X API usage reservation returned no ID.');
    return { id, operation: input.operation, estimatedCostMicrousd: input.estimatedCostMicrousd };
  }

  async settle(id: string, outcome: Exclude<XUsageOutcome, 'reserved'>, externalReference?: string): Promise<void> {
    await this.db().query(
      `UPDATE x_api_usage_ledger
       SET outcome = $2, external_reference = $3, settled_at = now()
       WHERE id = $1 AND outcome = 'reserved'`,
      [id, outcome, externalReference ?? null],
    );
  }

  private db(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('X API cost ledger database persistence is not configured.');
    this.pool = new Pool({ connectionString, max: 3 });
    return this.pool;
  }
}

@Injectable()
export class XApiCostService {
  estimate(operation: XUsageOperation): { estimatedCostMicrousd: number; pricingVersion: string } {
    const amount = this.positiveInteger(`X_API_COST_${operation.toUpperCase()}_MICRO_USD`);
    const maximum = this.optionalPositiveInteger('X_API_MAX_ESTIMATED_COST_MICRO_USD_PER_REQUEST');
    if (maximum !== null && amount > maximum) throw new ServiceUnavailableException('The estimated X API request cost exceeds the configured per-request cap.');
    const pricingVersion = process.env.X_API_PRICING_VERSION;
    if (!pricingVersion?.trim()) throw new ServiceUnavailableException('X_API_PRICING_VERSION must identify the verified X pricing snapshot.');
    return { estimatedCostMicrousd: amount, pricingVersion };
  }

  private positiveInteger(name: string): number {
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < 0) throw new ServiceUnavailableException(`${name} must be a non-negative integer micro-USD value.`);
    return value;
  }

  private optionalPositiveInteger(name: string): number | null {
    const raw = process.env[name];
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new ServiceUnavailableException(`${name} must be a non-negative integer micro-USD value.`);
    return value;
  }
}
