import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseService } from '../src/database/database.service';
import { OperationsService } from '../src/operations/operations.service';

test('operations queries are owner-scoped and bounded',async()=>{
  const calls:{sql:string;params:unknown[]}[]=[];
  const database={db:()=>({query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return {rows:[]};}})} as unknown as DatabaseService;
  const service=new OperationsService(database);
  await service.audit('owner-1');await service.failures('owner-1');
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(call=>call.params),[['owner-1'],['owner-1']]);
  assert.ok(calls.every(call=>/LIMIT 100/.test(call.sql)));
  assert.ok(calls[1].sql.includes('posts.owner_id=$1'));
});
