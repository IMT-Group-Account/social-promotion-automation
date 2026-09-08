import { BadRequestException, Controller, Get, Header, Param, Post, Req, ServiceUnavailableException, StreamableFile, UploadedFile, UseInterceptors, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PublicRoute } from '../auth/public-route.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

export function mediaExtension(buffer:Buffer,mime:string):string {
  if(mime==='image/jpeg'&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'jpg';
  if(mime==='image/png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(mime==='video/mp4'&&buffer.subarray(4,8).toString()==='ftyp')return 'mp4';
  throw new BadRequestException('JPEG, PNG 또는 MP4 파일만 업로드할 수 있습니다.');
}
@Controller('media')
export class MediaController {
  @Post()
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:32*1024*1024,files:1,fields:0}}))
  async upload(@Req() request:AuthenticatedRequest,@UploadedFile() file?:{buffer:Buffer;mimetype:string;size:number}) {
    if(!request.user)throw new BadRequestException('Authentication required.');
    if(!file?.buffer?.length)throw new BadRequestException('파일을 선택하세요.');
    const base=process.env.MEDIA_PUBLIC_BASE_URL;
    if(!base||new URL(base).protocol!=='https:')throw new ServiceUnavailableException('MEDIA_PUBLIC_BASE_URL must be a public HTTPS /api/media/files URL.');
    const extension=mediaExtension(file.buffer,file.mimetype);
    if(extension!=='mp4'&&file.size>8*1024*1024)throw new BadRequestException('이미지는 8MB 이하여야 합니다.');
    const name=`${randomUUID()}.${extension}`;
    const directory=this.directory();await mkdir(directory,{recursive:true});
    await writeFile(join(directory,name),file.buffer,{flag:'wx'});
    return {data:{type:extension==='mp4'?'video':'image',url:`${base.replace(/\/$/,'')}/${name}`,size:file.size},error:null,meta:{}};
  }
  @PublicRoute()
  @Get('files/:name')
  @Header('X-Content-Type-Options','nosniff')
  @Header('Cache-Control','public, max-age=31536000, immutable')
  async file(@Param('name')name:string):Promise<StreamableFile> {
    if(!/^[a-f0-9-]{36}\.(jpg|png|mp4)$/.test(name))throw new NotFoundException();
    const path=join(this.directory(),name);
    const info=await stat(path).catch(()=>null);if(!info?.isFile())throw new NotFoundException();
    return new StreamableFile(createReadStream(path),{type:name.endsWith('.mp4')?'video/mp4':name.endsWith('.png')?'image/png':'image/jpeg',length:info.size});
  }
  private directory():string {
    if(!process.env.MEDIA_STORAGE_DIR)throw new ServiceUnavailableException('MEDIA_STORAGE_DIR must point to persistent storage.');
    return resolve(process.env.MEDIA_STORAGE_DIR);
  }
}
