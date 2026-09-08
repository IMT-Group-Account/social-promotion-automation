import { NextRequest,NextResponse } from 'next/server';
export async function POST(request:NextRequest){
  const origin=new URL(process.env.APP_ORIGIN??request.url).origin;
  if(request.headers.get('origin')!==origin)return new NextResponse(null,{status:403});
  const response=NextResponse.redirect(new URL('/',origin),303);
  response.cookies.set('promotion_session','',{path:'/',maxAge:0});return response;
}
