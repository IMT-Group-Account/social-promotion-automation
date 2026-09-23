import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
export type RuntimeProcess='worker'|'scheduler';
@Injectable()
export class RuntimeHeartbeatService{
  constructor(private readonly database:DatabaseService){}
  async beat(processName:RuntimeProcess):Promise<void>{
    const releaseId=process.env.RELEASE_ID?.slice(0,200)||null;
    await this.database.db().query(`INSERT INTO runtime_heartbeats(process_name,release_id) VALUES($1,$2)
      ON CONFLICT(process_name) DO UPDATE SET release_id=EXCLUDED.release_id,heartbeat_at=now(),updated_at=now()`,[processName,releaseId]);
  }
  async readiness(required:RuntimeProcess[],staleAfterMs:number):Promise<Record<RuntimeProcess,boolean>>{
    await this.database.db().query('SELECT 1');
    const result:Record<RuntimeProcess,boolean>={worker:!required.includes('worker'),scheduler:!required.includes('scheduler')};
    if(!required.length)return result;
    const rows=await this.database.db().query<{process_name:RuntimeProcess;fresh:boolean}>(`SELECT process_name,heartbeat_at > now()-($2::bigint*interval '1 millisecond') AS fresh
      FROM runtime_heartbeats WHERE process_name=ANY($1::text[])`,[required,staleAfterMs]);
    for(const row of rows.rows)if(required.includes(row.process_name))result[row.process_name]=row.fresh;
    return result;
  }
}
