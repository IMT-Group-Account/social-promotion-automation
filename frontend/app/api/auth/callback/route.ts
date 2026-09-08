import { cookies } from 'next/headers';
import { NextRequest,NextResponse } from 'next/server';
export async function GET(request:NextRequest) {
  const jar=await cookies();const saved=jar.get('promotion_oauth')?.value;
  const origin=process.env.APP_ORIGIN;
  if(!origin)return NextResponse.json({error:'Authentication is not configured.'},{status:503});
  const response=NextResponse.redirect(new URL('/',origin));
  response.cookies.set('promotion_oauth','',{maxAge:0,path:'/api/auth/callback'});
  response.headers.set('cache-control','no-store');
  try {
    const state=saved?JSON.parse(saved) as {state:string;verifier:string}:null;
    const code=request.nextUrl.searchParams.get('code');
    if(!state||!code||request.nextUrl.searchParams.get('state')!==state.state)throw new Error();
    const endpoint=new URL(process.env.AUTH_TOKEN_URL??'');if(endpoint.protocol!=='https:')throw new Error();
    const body=new URLSearchParams({grant_type:'authorization_code',code,code_verifier:state.verifier,client_id:process.env.AUTH_CLIENT_ID??'',redirect_uri:`${origin}/api/auth/callback`});
    if(process.env.AUTH_CLIENT_SECRET)body.set('client_secret',process.env.AUTH_CLIENT_SECRET);
    const exchange=await fetch(endpoint,{method:'POST',body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    const tokens=await exchange.json();if(!exchange.ok||typeof tokens.access_token!=='string')throw new Error();
    // The backend verifies signature, issuer, audience, expiration and subject before a session is accepted.
    const check=await fetch(`${process.env.BACKEND_API_URL}/integrations`,{headers:{authorization:`Bearer ${tokens.access_token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!check.ok)throw new Error();
    response.cookies.set('promotion_session',tokens.access_token,{httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax',path:'/',maxAge:Math.min(3600,Math.max(1,Number(tokens.expires_in)||3600))});
    return response;
  }catch{response.headers.set('location',new URL('/?login=failed',origin).toString());return response;}
}
