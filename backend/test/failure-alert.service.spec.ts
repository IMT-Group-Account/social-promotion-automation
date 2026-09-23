import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseService } from '../src/database/database.service';
import { FailureAlertService } from '../src/publishing/failure-alert.service';

test('terminal failure alerts stay pending when webhook delivery is not configured',async()=>{
  const previous=process.env.FAILURE_ALERT_WEBHOOK_URL;delete process.env.FAILURE_ALERT_WEBHOOK_URL;
  try{
    const service=new FailureAlertService({db(){throw new Error('database must not be touched');}} as unknown as DatabaseService);
    assert.deepEqual(await service.dispatchPending(),{delivered:0,failed:0,disabled:true});
  }finally{if(previous===undefined)delete process.env.FAILURE_ALERT_WEBHOOK_URL;else process.env.FAILURE_ALERT_WEBHOOK_URL=previous;}
});

test('delivers a redacted failure alert and marks its outbox row delivered',async()=>{
  const previousUrl=process.env.FAILURE_ALERT_WEBHOOK_URL,previousFetch=globalThis.fetch;
  process.env.FAILURE_ALERT_WEBHOOK_URL='https://alerts.example.test/social';
  const queries:{sql:string;parameters:unknown[]|undefined}[]=[];
  const database={db:()=>({query:async(sql:string,parameters?:unknown[])=>{
    queries.push({sql,parameters});
    if(sql.includes('WITH candidates'))return {rows:[{id:'alert-1',social_publish_job_id:'job-1',post_id:'post-1',platform:'x',error_code:'RATE_LIMIT',retry_count:4,created_at:new Date('2026-09-23T00:00:00Z')}]};
    return {rows:[]};
  }})} as unknown as DatabaseService;
  let body='';
  globalThis.fetch=async(_input,init)=>{body=String(init?.body);return new Response(null,{status:204});};
  try{
    const result=await new FailureAlertService(database).dispatchPending();
    assert.deepEqual(result,{delivered:1,failed:0,disabled:false});
    assert.equal(JSON.parse(body).errorCode,'RATE_LIMIT');
    assert.equal(body.includes('errorMessage'),false);
    assert.ok(queries.some(query=>query.sql.includes("status='delivered'")));
  }finally{
    globalThis.fetch=previousFetch;
    if(previousUrl===undefined)delete process.env.FAILURE_ALERT_WEBHOOK_URL;else process.env.FAILURE_ALERT_WEBHOOK_URL=previousUrl;
  }
});
