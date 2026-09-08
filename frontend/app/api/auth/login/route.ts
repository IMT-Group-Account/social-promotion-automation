import { randomBytes, createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
export async function GET() {
  const {APP_ORIGIN,AUTH_AUTHORIZATION_URL,AUTH_CLIENT_ID}=process.env;
  if(!APP_ORIGIN||!AUTH_AUTHORIZATION_URL||!AUTH_CLIENT_ID)return NextResponse.json({error:'로그인 제공자 설정이 필요합니다.'},{status:503});
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const url=new URL(AUTH_AUTHORIZATION_URL);
  if(url.protocol!=='https:')return NextResponse.json({error:'HTTPS authentication endpoint required.'},{status:503});
  url.searchParams.set('response_type','code');url.searchParams.set('client_id',AUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri',`${APP_ORIGIN}/api/auth/callback`);
  url.searchParams.set('scope',process.env.AUTH_SCOPES??'openid profile');
  if(process.env.AUTH_AUDIENCE)url.searchParams.set('audience',process.env.AUTH_AUDIENCE);
  url.searchParams.set('state',state);url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');
  const response=NextResponse.redirect(url);
  response.cookies.set('promotion_oauth',JSON.stringify({state,verifier}),{httpOnly:true,secure:APP_ORIGIN.startsWith('https:'),sameSite:'lax',maxAge:600,path:'/api/auth/callback'});
  response.headers.set('cache-control','no-store');return response;
}
