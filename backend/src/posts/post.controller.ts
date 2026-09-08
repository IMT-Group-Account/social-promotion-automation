import { Body, Controller, Get, Param, ParseIntPipe, DefaultValuePipe, ParseUUIDPipe, Patch, Post, Query, Req, BadRequestException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AnalyticsService } from '../analytics/analytics.service';
import { ApprovePostDto, CreatePostDto, SchedulePostDto, UpdateDraftDto } from './post.dto';
import { PostService } from './post.service';
const result=<T>(data:T)=>({data,error:null,meta:{}});
@Controller('posts')
export class PostController {
  constructor(private readonly posts:PostService,private readonly analytics:AnalyticsService){}
  @Post() async create(@Req() r:AuthenticatedRequest,@Body() dto:CreatePostDto){return result(await this.posts.create(r.user!.id,dto));}
  @Get() async list(@Req() r:AuthenticatedRequest,@Query('offset',new DefaultValuePipe(0),ParseIntPipe) offset:number){
    if(offset<0||offset>100000)throw new BadRequestException('Invalid offset.');
    return result(await this.posts.list(r.user!.id,offset));
  }
  @Get(':id') async get(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){return result(await this.posts.findOwned(id,r.user!.id));}
  @Patch(':id') async update(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdateDraftDto){return result(await this.posts.update(r.user!.id,id,dto));}
  @Get(':id/preview') async preview(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){return result(await this.posts.preview(r.user!.id,id));}
  @Post(':id/publish') async publish(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ApprovePostDto){return result(await this.posts.publishNow(r.user!.id,id,dto.approvedRevision));}
  @Post(':id/schedule') async schedule(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SchedulePostDto){return result(await this.posts.schedule(r.user!.id,id,dto.scheduledAt,dto.approvedRevision));}
  @Post(':id/cancel') async cancel(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ApprovePostDto){return result(await this.posts.cancel(r.user!.id,id,dto.approvedRevision));}
  @Post(':id/jobs/:jobId/retry') async retry(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Param('jobId',ParseUUIDPipe) jobId:string,@Body() dto:ApprovePostDto){return result(await this.posts.retry(r.user!.id,id,jobId,dto.approvedRevision));}
  @Post(':id/duplicate') async duplicate(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){return result(await this.posts.duplicate(r.user!.id,id));}
  @Get(':id/results') async results(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){const v=await this.posts.findOwned(id,r.user!.id);return result({postId:id,status:v.post.status,jobs:v.jobs,revision:v.post.revision});}
  @Get(':id/analytics') async analyticsForPost(@Req() r:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){return result(await this.analytics.postDashboard(r.user!.id,id));}
}
