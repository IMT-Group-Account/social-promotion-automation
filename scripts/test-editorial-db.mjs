import assert from 'node:assert/strict';
import { readdir,readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import '../node_modules/reflect-metadata/Reflect.js';
import { DatabaseService } from '../dist/src/database/database.service.js';
import { PgPostRepository } from '../dist/src/posts/pg-post.repository.js';
import { PostService } from '../dist/src/posts/post.service.js';
import { CampaignService } from '../dist/src/campaigns/campaign.service.js';
import { MediaService } from '../dist/src/media/media.service.js';
import { PgPublishOutboxRepository } from '../dist/src/publishing/pg-publish-outbox.repository.js';
import { PublishingService } from '../dist/src/publishing/publishing.service.js';
import { FormatterService } from '../dist/src/publishing/formatter.service.js';
import { PublishWorkerProcessor } from '../dist/src/publishing/publish-worker.processor.js';

export async function testEditorialDatabase(connectionString){
  const url=new URL(connectionString);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/promotion_test_[a-z0-9_]+$/.test(url.pathname))throw new Error('Only a dedicated local promotion_test_* database is allowed.');
  const schema=`promotion_test_${randomUUID().replaceAll('-','')}`;
  const admin=new Pool({connectionString});
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options',`-c search_path=${schema},public`);
  const previous=process.env.DATABASE_URL;process.env.DATABASE_URL=url.toString();
  const db=new DatabaseService(),outbox=new PgPublishOutboxRepository();
  const campaignService=new CampaignService(db),repo=new PgPostRepository(db),service=new PostService(repo,new MediaService());
  let checks=0;
  const pass=(message)=>{checks++;console.log(`PASS ${message}`);};
  try{
    for(const name of (await readdir(new URL('../backend/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
      const sql=await readFile(new URL(`../backend/migrations/${name}`,import.meta.url),'utf8');
      await db.transaction(client=>client.query(sql));
    }
    pass('all 14 migrations execute on real PostgreSQL');
    const owner=randomUUID(),other=randomUUID();
    const campaign=await campaignService.create(owner,'Editorial integration fixture');
    await db.db().query('INSERT INTO users(id) VALUES($1)',[other]);
    const ids=[randomUUID(),randomUUID()];
    for(const [i,platform] of ['facebook','x'].entries())await db.db().query(`INSERT INTO social_accounts(id,user_id,platform,platform_account_id,access_token_encrypted,status,scope)
      VALUES($1,$2,$3,$4,'test-ciphertext-never-sent','active',$5)`,[ids[i],owner,platform,`test-${ids[i]}`,i?['tweet.read','tweet.write','users.read']:['pages_manage_posts']]);
    const dto={campaignId:campaign.id,content:{title:'Fixture',body:'Original editorial source',url:null,media:[],platformBodies:{facebook:'Reviewed Facebook variant'}},targets:ids.map((accountId,i)=>({accountId,platform:i?'x':'facebook'})),scheduledAt:new Date(Date.now()+60000).toISOString()};
    const record=await service.create(owner,dto),id=record.post.id;
    assert.equal(record.post.status,'draft');
    assert.equal(Number((await db.db().query('SELECT count(*) FROM social_publish_queue_outbox')).rows[0].count),0);
    const anotherDb=new DatabaseService();
    try{const reread=await new PostService(new PgPostRepository(anotherDb),new MediaService()).findOwned(id,owner);assert.equal(reread.post.content.body,dto.content.body);assert.equal(reread.post.revision,1);}finally{await anotherDb.onModuleDestroy();}
    pass('draft persists across repository connections without enqueueing');
    await assert.rejects(service.findOwned(id,other));
    await assert.rejects(service.create(other,dto));
    const otherCampaign=await campaignService.create(other,'Other owner');
    await assert.rejects(service.create(other,{...dto,campaignId:otherCampaign.id}));
    assert.equal(Number((await db.db().query('SELECT count(*) FROM posts')).rows[0].count),1);
    pass('foreign campaign/account access rolls back without orphan posts');
    const preview=await service.preview(owner,id);assert.equal(preview.items.find(i=>i.platform==='facebook').body,'Reviewed Facebook variant');
    await service.update(owner,id,{revision:1,content:{...dto.content,body:'Updated original'}});
    await assert.rejects(service.schedule(owner,id,dto.scheduledAt,1));
    await db.db().query("UPDATE social_accounts SET scope='{}' WHERE id=$1",[ids[0]]);
    await assert.rejects(service.schedule(owner,id,dto.scheduledAt,2),/게시 권한/);
    assert.equal((await service.findOwned(id,owner)).post.revision,2);
    assert.equal(Number((await db.db().query('SELECT count(*) FROM social_publish_queue_outbox')).rows[0].count),0);
    await db.db().query("UPDATE social_accounts SET scope=ARRAY['pages_manage_posts'] WHERE id=$1",[ids[0]]);
    pass('missing publishing permission prevents approval and rolls back queue changes');
    const approvals=await Promise.allSettled([service.schedule(owner,id,dto.scheduledAt,2),service.schedule(owner,id,dto.scheduledAt,2)]);
    assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);
    const firstQueue=(await db.db().query('SELECT * FROM social_publish_queue_outbox ORDER BY publish_job_id')).rows;
    assert.equal(firstQueue.length,2);
    pass('only one concurrent approval succeeds; saved revision gates publication');
    await service.schedule(owner,id,new Date(Date.now()+120000).toISOString(),3);
    const secondQueue=(await db.db().query('SELECT * FROM social_publish_queue_outbox ORDER BY publish_job_id')).rows;
    assert.notEqual(firstQueue[0].queue_job_id,secondQueue[0].queue_job_id);
    await db.db().query("UPDATE social_publish_jobs SET scheduled_at=now()-interval '1 second' WHERE post_id=$1",[id]);
    assert.equal(await outbox.claimPublishJob(firstQueue[0].publish_job_id,30000,firstQueue[0].queue_job_id),null);
    const queue=(await db.db().query('SELECT * FROM social_publish_queue_outbox ORDER BY publish_job_id')).rows;
    let remoteWrites=0;
    const fakeAdapter={platform:'facebook',async publish(input){remoteWrites++;assert.equal(input.body,'Reviewed Facebook variant');return{remotePostId:'fixture-remote',remotePostUrl:'https://example.com/fixture',publishedAt:new Date()};}};
    const processor=new PublishWorkerProcessor(outbox,new PublishingService([fakeAdapter],new FormatterService()));
    const fb=record.jobs.find(j=>j.platform==='facebook'),x=record.jobs.find(j=>j.platform==='x');
    const fbQueue=queue.find(q=>q.publish_job_id===fb.id);
    await processor.process(fb.id,30000,1,fbQueue.queue_job_id);
    await processor.process(fb.id,30000,2,fbQueue.queue_job_id);
    assert.equal(remoteWrites,1);
    assert.equal((await service.findOwned(id,owner)).jobs.find(j=>j.id===fb.id).status,'published');
    assert.equal(Number((await db.db().query('SELECT count(*) FROM social_posts')).rows[0].count),1);
    pass('stale queue is ignored; duplicate worker delivery writes to fake provider once');
    await db.db().query("UPDATE social_publish_jobs SET status='failed',error_code='TEST_FAILURE',error_message='Fixture',retry_count=1 WHERE id=$1",[x.id]);
    const before=await service.findOwned(id,owner);
    await service.retry(owner,id,x.id,before.post.revision);
    const retried=await service.findOwned(id,owner);
    assert.deepEqual(retried.jobs.find(j=>j.id===fb.id),before.jobs.find(j=>j.id===fb.id));
    assert.equal(retried.jobs.find(j=>j.id===x.id).status,'waiting');
    pass('manual retry keeps the published sibling unchanged');
    await db.db().query("UPDATE social_publish_jobs SET status='failed',error_code='AMBIGUOUS_REMOTE_OUTCOME',remote_request_key='fixture-key',retry_count=1 WHERE id=$1",[x.id]);
    await assert.rejects(service.retry(owner,id,x.id,retried.post.revision));
    await assert.rejects(service.cancel(owner,id,retried.post.revision));
    await db.db().query("UPDATE social_publish_jobs SET status='remote_confirmed',remote_post_id='confirmed-before-crash',published_at=now(),lease_expires_at=NULL WHERE id=$1",[x.id]);
    const xQueue=(await db.db().query('SELECT queue_job_id FROM social_publish_queue_outbox WHERE publish_job_id=$1',[x.id])).rows[0];
    await processor.process(x.id,30000,1,xQueue.queue_job_id);
    assert.equal((await service.findOwned(id,owner)).post.status,'completed');assert.equal(remoteWrites,1);
    pass('ambiguous retry is blocked; durable remote confirmation recovers without another provider call');
    const cancelled=await service.create(owner,dto);
    await service.publishNow(owner,cancelled.post.id,1);
    await service.cancel(owner,cancelled.post.id,2);
    assert.equal((await service.findOwned(cancelled.post.id,owner)).post.status,'cancelled');
    assert.equal(Number((await db.db().query('SELECT count(*) FROM social_publish_queue_outbox o JOIN social_publish_jobs j ON j.id=o.publish_job_id WHERE j.post_id=$1',[cancelled.post.id])).rows[0].count),0);
    pass('cancellation removes dispatch eligibility');
    const clone=await service.duplicate(owner,id);assert.equal(clone.post.status,'draft');assert.notEqual(clone.post.id,id);
    assert.ok(clone.jobs.every(j=>j.remotePostId===null));
    pass('copy creates a fresh unapproved draft');
    console.log(`Editorial PostgreSQL checks: ${checks} passed. Provider writes were test doubles.`);
  }finally{
    await outbox.onModuleDestroy();await db.onModuleDestroy();
    if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;
    if(!/^promotion_test_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe test schema cleanup target.');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
}
if(process.argv[1]&&resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1])){
  if(!process.env.TEST_DATABASE_URL)throw new Error('Set TEST_DATABASE_URL to a dedicated local promotion_test_* database.');
  await testEditorialDatabase(process.env.TEST_DATABASE_URL);
}
