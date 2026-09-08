import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MediaService } from '../media/media.service';
import type { CreatePostDto, UpdateDraftDto } from './post.dto';
import { POST_REPOSITORY, type PostRepository, type PostRecord } from './post.repository';
import { type Post, type PostStatus, type SocialPublishJob } from './post.entity';
import { FormatterService } from '../publishing/formatter.service';

@Injectable()
export class PostService {
  constructor(@Inject(POST_REPOSITORY) private readonly repository:PostRepository,private readonly media:MediaService) {}
  async create(ownerId:string,dto:CreatePostDto):Promise<PostRecord> {
    if (!dto.content?.body?.trim() || !dto.targets?.length) throw new BadRequestException('Content and targets are required.');
    const keys=dto.targets.map(t=>`${t.platform}:${t.accountId}`);
    if (new Set(keys).size!==keys.length) throw new BadRequestException('Duplicate social target.');
    const post:Post={id:randomUUID(),campaignId:dto.campaignId,ownerId,revision:1,
      content:{...dto.content,url:dto.content.url??null,media:this.media.validate(dto.content.media)},scheduledAt:new Date(dto.scheduledAt),status:'draft'};
    const jobs:SocialPublishJob[]=dto.targets.map(t=>({id:randomUUID(),postId:post.id,platform:t.platform,accountId:t.accountId,
      status:'waiting',scheduledAt:post.scheduledAt,publishedAt:null,remotePostId:null,remotePostUrl:null,errorCode:null,errorMessage:null,
      retryCount:0,leaseExpiresAt:null,nextRetryAt:null,remoteRequestKey:null,remoteRequestStartedAt:null}));
    await this.repository.save(post,jobs);return {post,jobs};
  }
  summarizeStatus(jobs:readonly SocialPublishJob[]):PostStatus {
    if (!jobs.length) return 'draft';
    if (jobs.every(j=>j.status==='cancelled')) return 'cancelled';
    if (jobs.every(j=>j.status==='published')) return 'completed';
    if (jobs.some(j=>['claimed','remote_requesting','remote_confirmed'].includes(j.status))) return 'publishing';
    if (jobs.every(j=>['failed','cancelled'].includes(j.status))) return 'failed';
    if (jobs.some(j=>['failed','cancelled'].includes(j.status))) return 'partially_failed';
    return 'scheduled';
  }
  async findOwned(id:string,ownerId:string):Promise<PostRecord> { return this.present(await this.repository.findOwned(id,ownerId)); }
  async list(ownerId:string,offset=0):Promise<readonly PostRecord[]> { return (await this.repository.list(ownerId,offset)).map(r=>this.present(r)); }
  async update(ownerId:string,id:string,dto:UpdateDraftDto):Promise<PostRecord> {
    return this.repository.mutate(id,ownerId,r=>{
      this.revision(r,dto.revision);
      if (r.post.status!=='draft') throw new ConflictException('Only drafts can be edited. Copy this post to create a new draft.');
      if (!dto.content.body.trim()) throw new BadRequestException('Content is required.');
      return {...r,post:{...r.post,content:{...dto.content,url:dto.content.url??null,media:this.media.validate(dto.content.media)}}};
    });
  }
  async preview(ownerId:string,id:string) {
    const r=await this.findOwned(id,ownerId);const formatter=new FormatterService();
    return {revision:r.post.revision,items:r.jobs.map(job=>({accountId:job.accountId,...formatter.format(r.post,job)})),issues:this.issues(r)};
  }
  async schedule(ownerId:string,id:string,time:string,approvedRevision:number):Promise<PostRecord> {
    const scheduledAt=new Date(time);
    if (!Number.isFinite(scheduledAt.valueOf()) || scheduledAt<=new Date()) throw new BadRequestException('Schedule must be in the future.');
    return this.repository.mutate(id,ownerId,r=>{
      this.revision(r,approvedRevision);
      if (r.jobs.some(j=>!['waiting','cancelled'].includes(j.status)||j.remoteRequestKey)) throw new ConflictException('Processing or completed posts cannot be rescheduled.');
      if (r.post.status==='cancelled') throw new ConflictException('Copy the cancelled post to a new draft.');
      const issues=this.issues(r);if(issues.length)throw new BadRequestException(issues.join(' '));
      return {post:{...r.post,status:'scheduled',scheduledAt},jobs:r.jobs.map(j=>j.status==='cancelled'?j:{...j,scheduledAt,status:'waiting'})};
    });
  }
  publishNow(ownerId:string,id:string,revision:number):Promise<PostRecord> {return this.schedule(ownerId,id,new Date(Date.now()+1000).toISOString(),revision);}
  async cancel(ownerId:string,id:string,revision:number):Promise<PostRecord> {
    return this.repository.mutate(id,ownerId,r=>{
      this.revision(r,revision);
      if(r.jobs.some(j=>['claimed','remote_requesting','remote_confirmed'].includes(j.status)||j.remoteRequestKey&&j.status!=='published'))throw new ConflictException('Publication is in progress or needs reconciliation.');
      const jobs=r.jobs.map(j=>['waiting','retrying','failed'].includes(j.status)?{...j,status:'cancelled' as const,nextRetryAt:null}:j);
      return {post:{...r.post,status:this.summarizeStatus(jobs)},jobs};
    });
  }
  async retry(ownerId:string,id:string,jobId:string,revision:number):Promise<PostRecord> {
    return this.repository.mutate(id,ownerId,r=>{
      this.revision(r,revision);const job=r.jobs.find(j=>j.id===jobId);
      if(!job)throw new NotFoundException('Job not found.');
      if(job.status!=='failed'||job.remoteRequestKey||job.remotePostId)throw new ConflictException('Only a confirmed failed request can be retried. Ambiguous results require reconciliation.');
      return {post:{...r.post,status:'scheduled'},jobs:r.jobs.map(j=>j.id===jobId?{...j,status:'waiting',scheduledAt:new Date(),errorCode:null,errorMessage:null,retryCount:0,nextRetryAt:null}:j)};
    });
  }
  async duplicate(ownerId:string,id:string):Promise<PostRecord> {
    const r=await this.findOwned(id,ownerId);
    return this.create(ownerId,{campaignId:r.post.campaignId,content:{...r.post.content,media:[...r.post.content.media]},targets:r.jobs.map(j=>({platform:j.platform,accountId:j.accountId})),scheduledAt:new Date(Date.now()+86400000).toISOString()});
  }
  private revision(r:PostRecord,n:number):void {if(n!==(r.post.revision??1))throw new ConflictException('Content changed. Reload and review the latest version.');}
  private present(r:PostRecord):PostRecord {return {...r,post:{...r.post,status:r.post.status==='draft'?'draft':this.summarizeStatus(r.jobs)}};}
  private issues(r:PostRecord):string[] {
    const issues:string[]=[];
    const formatter=new FormatterService();
    for(const j of r.jobs){
      const formatted=formatter.format(r.post,j);
      const limit={linkedin:3000,instagram:2200,facebook:10000,threads:500,x:280}[j.platform];
      const bodyLength=[...formatted.body].reduce((total,c)=>total+(j.platform==='x'&&c.codePointAt(0)!>127?2:1),0);
      const linkLength=r.post.content.url&&['threads','x'].includes(j.platform)?(j.platform==='x'?24:[...r.post.content.url].length+1):0;
      if(bodyLength+linkLength>limit)issues.push(`${j.platform}: 링크를 포함한 최종 문구가 너무 깁니다. SNS별 문구를 줄여주세요.`);
      if(j.platform==='instagram'&&r.post.content.media.length!==1)issues.push('Instagram: 이미지 또는 동영상 1개가 필요합니다.');
      if(j.platform==='instagram'&&r.post.content.media.some(m=>m.type==='image'&&new URL(m.url).pathname.toLowerCase().endsWith('.png')))issues.push('Instagram: PNG 대신 JPEG 이미지를 사용하세요. 정사각형 업로드는 JPEG로 변환합니다.');
      if(j.platform==='linkedin'&&r.post.content.media.length)issues.push('LinkedIn: 현재 텍스트·링크 게시만 지원합니다. 미디어를 제거하거나 별도 초안으로 작성하세요.');
      if(j.platform!=='x'&&r.post.content.media.length>1)issues.push(`${j.platform}: 현재 미디어 1개까지만 지원합니다.`);
    }
    return [...new Set(issues)];
  }
}
