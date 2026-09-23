import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PublicRoute } from '../auth/public-route.decorator';
import { RuntimeHeartbeatService,type RuntimeProcess } from '../runtime/runtime-heartbeat.service';

@PublicRoute()
@Controller('health')
export class HealthController {
  constructor(private readonly heartbeat:RuntimeHeartbeatService){}
  @Get()
  check(): { readonly data: { readonly status: 'ok' }; readonly error: null; readonly meta: Record<string, never> } {
    return { data: { status: 'ok' }, error: null, meta: {} };
  }
  @Get('ready')
  async ready(){
    const required:RuntimeProcess[]=[];
    if(process.env.READINESS_REQUIRE_WORKER==='true')required.push('worker');
    if(process.env.READINESS_REQUIRE_SCHEDULER==='true')required.push('scheduler');
    const staleAfterMs=this.staleAfterMs();
    try{
      const status=await this.heartbeat.readiness(required,staleAfterMs);
      if(required.some(name=>!status[name]))throw new Error();
      return {data:{status:'ready' as const},error:null,meta:{}};
    }catch{throw new ServiceUnavailableException('Runtime dependencies are not ready.');}
  }
  private staleAfterMs():number{
    const raw=process.env.RUNTIME_HEARTBEAT_STALE_MS??'120000';
    const value=Number(raw);
    if(!Number.isInteger(value)||value<30000||value>3600000)throw new ServiceUnavailableException('Runtime readiness is not configured safely.');
    return value;
  }
}
