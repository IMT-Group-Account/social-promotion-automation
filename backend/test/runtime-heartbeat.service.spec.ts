import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseService } from '../src/database/database.service';
import { HealthController } from '../src/health/health.controller';
import { RuntimeHeartbeatService } from '../src/runtime/runtime-heartbeat.service';

test('runtime readiness requires fresh configured worker and scheduler heartbeats',async()=>{
  const queries:string[]=[];
  const database={db:()=>({query:async(sql:string)=>{queries.push(sql);return sql==='SELECT 1'?{rows:[{}]}:{rows:[{process_name:'worker',fresh:true},{process_name:'scheduler',fresh:false}]};}})} as unknown as DatabaseService;
  const service=new RuntimeHeartbeatService(database);
  assert.deepEqual(await service.readiness(['worker','scheduler'],120000),{worker:true,scheduler:false});
  assert.equal(queries.length,2);
});

test('public readiness response fails closed without exposing dependency details',async()=>{
  const previousWorker=process.env.READINESS_REQUIRE_WORKER;process.env.READINESS_REQUIRE_WORKER='true';
  const heartbeat={readiness:async()=>({worker:false,scheduler:true})} as unknown as RuntimeHeartbeatService;
  try{await assert.rejects(new HealthController(heartbeat).ready(),/Runtime dependencies are not ready/);}
  finally{if(previousWorker===undefined)delete process.env.READINESS_REQUIRE_WORKER;else process.env.READINESS_REQUIRE_WORKER=previousWorker;}
});
