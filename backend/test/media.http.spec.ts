import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { MediaController } from '../src/media/media.controller';
import { ServiceJwtAuthGuard } from '../src/auth/service-jwt-auth.guard';
import { ServiceJwtVerifier } from '../src/auth/service-jwt-verifier.service';

test('authenticated multipart upload persists bytes; public media readback, MIME rejection, and missing auth are enforced',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'promotion-media-test-'));
  const oldDir=process.env.MEDIA_STORAGE_DIR,oldBase=process.env.MEDIA_PUBLIC_BASE_URL;
  process.env.MEDIA_STORAGE_DIR=directory;process.env.MEDIA_PUBLIC_BASE_URL='https://media.example.test/api/media/files';
  const module=await Test.createTestingModule({controllers:[MediaController]}).compile();
  const app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');
  app.useGlobalGuards(new ServiceJwtAuthGuard(new Reflector(),{verify:async()=>({id:'fixture-owner'})} as unknown as ServiceJwtVerifier));
  await app.listen(0,'127.0.0.1');const origin=await app.getUrl();
  const bytes=Buffer.from([255,216,255,224,0,2,255,217]);
  const form=()=>{const f=new FormData();f.append('file',new Blob([bytes],{type:'image/jpeg'}),'test.jpg');return f;};
  try{
    assert.equal((await fetch(`${origin}/api/media`,{method:'POST',body:form()})).status,401);
    const response=await fetch(`${origin}/api/media`,{method:'POST',headers:{authorization:'Bearer fixture.session.only'},body:form()});
    assert.equal(response.status,201);const uploaded=await response.json() as {data:{url:string;type:string}};
    assert.equal(uploaded.data.type,'image');
    const path=new URL(uploaded.data.url).pathname;
    assert.deepEqual(await readFile(join(directory,basename(path))),bytes);
    const download=await fetch(`${origin}${path}`);assert.equal(download.status,200);
    assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
    const spoof=new FormData();spoof.append('file',new Blob(['<script>bad</script>'],{type:'image/jpeg'}),'fake.jpg');
    assert.equal((await fetch(`${origin}/api/media`,{method:'POST',headers:{authorization:'Bearer fixture.session.only'},body:spoof})).status,400);
    assert.equal((await fetch(`${origin}/api/media/files/not-a-file.jpg`)).status,404);
  }finally{
    await app.close();
    if(oldDir===undefined)delete process.env.MEDIA_STORAGE_DIR;else process.env.MEDIA_STORAGE_DIR=oldDir;
    if(oldBase===undefined)delete process.env.MEDIA_PUBLIC_BASE_URL;else process.env.MEDIA_PUBLIC_BASE_URL=oldBase;
  }
});
