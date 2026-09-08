import { Controller, Get, Query, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OauthService } from './oauth.service';
import { PublicRoute } from './public-route.decorator';
import type { OAuthCallbackRoute } from './oauth.types';
type CallbackQuery={state?:string;code?:string;error?:string};
type HtmlResponse={setHeader(name:string,value:string):void;type(value:string):HtmlResponse;send(body:string):void};
@PublicRoute()
@Controller('oauth')
export class OauthController {
  constructor(private readonly oauth:OauthService){}
  @Get('linkedin/callback') linkedIn(@Query()q:CallbackQuery,@Res()r:HtmlResponse){return this.complete('linkedin',q,r);}
  @Get('meta/callback') meta(@Query()q:CallbackQuery,@Res()r:HtmlResponse){return this.complete('meta',q,r);}
  @Get('threads/callback') threads(@Query()q:CallbackQuery,@Res()r:HtmlResponse){return this.complete('threads',q,r);}
  @Get('x/callback') x(@Query()q:CallbackQuery,@Res()r:HtmlResponse){return this.complete('x',q,r);}
  private async complete(route:OAuthCallbackRoute,q:CallbackQuery,r:HtmlResponse){
    let payload:unknown;
    try {payload={type:'promotion-oauth',data:await this.oauth.completeCallback(route,q)};}
    catch {payload={type:'promotion-oauth',error:'SNS 연결에 실패했습니다. 권한을 확인하고 다시 연결하세요.'};}
    const origin=process.env.ADMIN_CONSOLE_ORIGIN;
    const nonce=randomBytes(16).toString('base64');
    r.setHeader('Cache-Control','no-store');r.setHeader('Referrer-Policy','no-referrer');
    r.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`);
    const safe=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
    r.type('html').send(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>SNS 연결</title><p>관리자 화면으로 돌아가 연결 결과를 확인하세요.</p>${origin?`<script nonce="${nonce}">if(window.opener){window.opener.postMessage(${safe(payload)},${safe(new URL(origin).origin)});window.close();}</script>`:''}</html>`);
  }
}
