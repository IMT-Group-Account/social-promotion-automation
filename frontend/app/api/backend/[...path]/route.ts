import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
async function boundedBody(request:NextRequest):Promise<ArrayBuffer|undefined>{
  if(!request.body)return undefined;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new RangeError();}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result.buffer;
}
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
  const {path}=await context.params;
  if(!['posts','campaigns','integrations','media'].includes(path[0])||path.some(p=>!/^[-a-zA-Z0-9]+$/.test(p)))return new NextResponse(null,{status:404});
  if(request.method!=='GET'&&request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??request.url).origin)return new NextResponse(null,{status:403});
  const token=(await cookies()).get('promotion_session')?.value;
  if(!token)return NextResponse.json({error:{message:'로그인이 필요합니다.'}},{status:401});
  const base=process.env.BACKEND_API_URL;
  if(!base)return NextResponse.json({error:{message:'서버 연결 설정이 필요합니다.'}},{status:503});
  try {
    const hasBody=!['GET','HEAD'].includes(request.method);
    const body=hasBody?await boundedBody(request):undefined;
    const response=await fetch(`${base.replace(/\/$/,'')}/${path.join('/')}${request.nextUrl.search}`,{
      method:request.method,headers:{authorization:`Bearer ${token}`,'content-type':request.headers.get('content-type')??'application/json'},
      body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000),
    });
    return new NextResponse(await response.arrayBuffer(),{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store'}});
  } catch(error) {return NextResponse.json({error:{message:error instanceof RangeError?'파일은 4MB 미만으로 준비하세요.':'서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'}},{status:error instanceof RangeError?413:502});}
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as DELETE};
