import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PostService } from '../src/posts/post.service';
import { InMemoryPostRepository } from '../src/posts/post.repository';
import { MediaService } from '../src/media/media.service';
import { mediaExtension } from '../src/media/media.controller';
import { ValidationPipe } from '@nestjs/common';
import { globalValidationPipeOptions } from '../src/validation/global-validation.pipe';
import { CreatePostDto, UpdateDraftDto } from '../src/posts/post.dto';
import { missingPublishingScopes } from '../src/publishing/publishing-permissions';

const dto=()=>({campaignId:randomUUID(),content:{title:'Title',body:'Original copy',url:null,media:[]},targets:[{platform:'facebook' as const,accountId:randomUUID()},{platform:'x' as const,accountId:randomUUID()}],scheduledAt:new Date(Date.now()+60000).toISOString()});
const setup=()=>{const repo=new InMemoryPostRepository();return {repo,service:new PostService(repo,new MediaService())};};
test('approval rejects stale content revisions, and preview uses saved platform copy',async()=>{
  const {service}=setup();const {post}=await service.create('owner',dto());
  assert.equal(post.status,'draft');
  const updated=await service.update('owner',post.id,{revision:1,content:{...dto().content,platformBodies:{facebook:'Reviewed Facebook copy'}}});
  assert.equal(updated.post.revision,2);
  const preview=await service.preview('owner',post.id);
  assert.equal(preview.items.find(i=>i.platform==='facebook')?.body,'Reviewed Facebook copy');
  await assert.rejects(service.publishNow('owner',post.id,1),/Content changed/);
  const approved=await service.publishNow('owner',post.id,2);
  assert.equal(approved.post.status,'scheduled');
  await assert.rejects(service.update('owner',post.id,{revision:3,content:dto().content}),/Only drafts/);
});
test('manual retry changes only a definite failed job and blocks ambiguous outcomes',async()=>{
  const {service,repo}=setup();const r=await service.create('owner',dto());
  await repo.save({...r.post,status:'scheduled'},r.jobs.map((j,i)=>i===0?{...j,status:'failed',errorCode:'RATE_LIMIT',retryCount:1}:j));
  const next=await service.retry('owner',r.post.id,r.jobs[0].id,1);
  assert.equal(next.jobs[0].status,'waiting');assert.deepEqual(next.jobs[1],r.jobs[1]);
  await repo.save({...next.post,revision:3},next.jobs.map((j,i)=>i===0?{...j,status:'failed',remoteRequestKey:'request',errorCode:'AMBIGUOUS_REMOTE_OUTCOME'}:j));
  await assert.rejects(service.retry('owner',r.post.id,r.jobs[0].id,3),/Ambiguous/);
  await assert.rejects(service.cancel('owner',r.post.id,3),/reconciliation/);
});
test('cancellation preserves published siblings and another owner cannot read a post',async()=>{
  const {service,repo}=setup();const r=await service.create('owner',dto());
  const published={...r.jobs[0],status:'published' as const,remotePostId:'remote',remoteRequestKey:'key',publishedAt:new Date()};
  await repo.save({...r.post,status:'scheduled'},[published,r.jobs[1]]);
  await assert.rejects(service.findOwned(r.post.id,'other'),/not found/);
  const next=await service.cancel('owner',r.post.id,1);
  assert.deepEqual(next.jobs[0],published);assert.equal(next.jobs[1].status,'cancelled');
});
test('media upload rejects spoofed MIME and unsupported executable content',()=>{
  assert.equal(mediaExtension(Buffer.from([255,216,255,0]),'image/jpeg'),'jpg');
  assert.throws(()=>mediaExtension(Buffer.from('<svg onload="alert(1)"/>'),'image/jpeg'));
  assert.throws(()=>mediaExtension(Buffer.from('MZ executable'),'video/mp4'));
});
test('missing content and unexpected override platforms are rejected by HTTP validation',async()=>{
  const pipe=new ValidationPipe(globalValidationPipeOptions);
  await assert.rejects(pipe.transform({revision:1},{type:'body',metatype:UpdateDraftDto}));
  await assert.rejects(pipe.transform({...dto(),content:{...dto().content,platformBodies:{unknown:'copy'}}},{type:'body',metatype:CreatePostDto}));
});
test('preflight blocks incompatible media and oversized final captions before scheduling',async()=>{
  const {service}=setup();
  const input=dto();input.targets=[{platform:'facebook',accountId:randomUUID()}];
  const r=await service.create('owner',{...input,targets:[{platform:'instagram',accountId:randomUUID()}]});
  assert.ok((await service.preview('owner',r.post.id)).issues.some(i=>i.includes('1개')));
  await assert.rejects(service.publishNow('owner',r.post.id,1));
  await service.update('owner',r.post.id,{revision:1,content:{...input.content,body:'a'.repeat(2300),media:[{type:'image',url:'https://example.com/image.jpg'}]}});
  assert.ok((await service.preview('owner',r.post.id)).issues.some(i=>i.includes('너무 깁니다')));
  await assert.rejects(service.publishNow('owner',r.post.id,2));
  assert.deepEqual(missingPublishingScopes('x',['tweet.read'],'account'),['tweet.write','users.read']);
  assert.deepEqual(missingPublishingScopes('linkedin',['w_member_social'],'urn:li:organization:123'),['w_organization_social']);
});
