import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool?: Pool;
  db(): Pool {
    if (!process.env.DATABASE_URL) throw new ServiceUnavailableException('DATABASE_URL is not configured.');
    return this.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db().connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy(): Promise<void> { await this.pool?.end(); }
}
