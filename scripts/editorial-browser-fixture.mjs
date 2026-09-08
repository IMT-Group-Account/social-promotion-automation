// Local-only UI fixture. Never imported by the application and never calls an SNS provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import 'reflect-metadata';
import { PostService } from '../dist/src/posts/post.service.js';
import { InMemoryPostRepository } from '../dist/src/posts/post.repository.js';
import { MediaService } from '../dist/src/media/media.service.js';
const owner=randomUUID(),campaign={id:randomUUID(),name:'로컬 검증 캠페인 (실제 게시 없음)'};
const accounts=['instagram','facebook','threads','linkedin','x'].map(platform=>({id:randomUUID(),platform,accountName:`검증용 ${platform}`,status:'active',expiresAt:null,scope:['fixture-only']}));
const repo=new InMemoryPostRepository(),service=new PostService(repo,new MediaService());
const campaigns=[campaign];
const fixture=await service.create(owner,{campaignId:campaign.id,content:{title:'실패 복구 검증',body:'로컬 테스트 데이터입니다.',url:null,media:[]},targets:accounts.filter(a=>['facebook','x'].includes(a.platform)).map(a=>({platform:a.platform,accountId:a.id})),scheduledAt:new Date().toISOString()});
await repo.save({...fixture.post,status:'scheduled'},fixture.jobs.map((j,i)=>({...j,status:i?'failed':'published',errorCode:i?'RATE_LIMIT':null,errorMessage:i?'검증용 사용 한도 오류':null,remoteRequestKey:i?null:'fixture-confirmed',remotePostUrl:i?null:'https://example.com/fixture',remotePostId:i?null:'fixture',publishedAt:i?null:new Date(),retryCount:i?1:0})));
const port=3199,frontend='http://localhost:3100';
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://localhost:${port}`);
  res.setHeader('cache-control','no-store');
  if(url.pathname==='/start'){res.writeHead(302,{'set-cookie':'promotion_session=fixture.session.only; HttpOnly; SameSite=Lax; Path=/','location':frontend});res.end();return;}
  if(url.pathname==='/oauth'){
    res.setHeader('content-type','text/html; charset=utf-8');res.end(`<p>로컬 연결 확인</p><script>window.opener.postMessage({type:'promotion-oauth',data:{id:'fixture'}},${JSON.stringify(frontend)});window.close();</script>`);return;
  }
  if(req.headers.authorization!=='Bearer fixture.session.only'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({message:'Test session required'}));return;}
  let body={};
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  if(chunks.length&&req.headers['content-type']?.includes('application/json'))body=JSON.parse(Buffer.concat(chunks).toString());
  const parts=url.pathname.replace(/^\/api\//,'').split('/');
  try{
    let data;
    if(parts[0]==='integrations'){
      if(req.method==='DELETE'){const account=accounts.find(a=>a.id===parts[1]);account.status='revoked';data={disconnected:true};}
      else if(parts[2]==='connect')data={authorizationUrl:`http://localhost:${port}/oauth`};
      else data=accounts;
    }else if(parts[0]==='campaigns'){
      if(req.method==='POST'){data={id:randomUUID(),name:body.name};campaigns.push(data);}else data=campaigns;
    }else if(parts[0]==='posts'){
      const id=parts[1],action=parts[2];
      if(!id)data=req.method==='POST'?await service.create(owner,body):await service.list(owner,Number(url.searchParams.get('offset')??0));
      else if(req.method==='PATCH')data=await service.update(owner,id,body);
      else if(action==='preview')data=await service.preview(owner,id);
      else if(action==='schedule')data=await service.schedule(owner,id,body.scheduledAt,body.approvedRevision);
      else if(action==='publish')data=await service.publishNow(owner,id,body.approvedRevision);
      else if(action==='cancel')data=await service.cancel(owner,id,body.approvedRevision);
      else if(action==='duplicate')data=await service.duplicate(owner,id);
      else if(action==='jobs')data=await service.retry(owner,id,parts[3],body.approvedRevision);
      else data=await service.findOwned(id,owner);
    }else throw new Error('Unknown fixture route');
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data,error:null,meta:{fixture:true}}));
  }catch(error){res.writeHead(error.getStatus?.()??400,{'content-type':'application/json'});res.end(JSON.stringify({message:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local UI fixture: http://localhost:${port}/start`));
