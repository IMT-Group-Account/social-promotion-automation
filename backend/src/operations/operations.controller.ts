import { Controller,Get,Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { RequireRoles } from '../auth/roles.decorator';
import { OperationsService } from './operations.service';
const result=<T>(data:T)=>({data,error:null,meta:{}});
@Controller('operations')
@RequireRoles('admin')
export class OperationsController {
  constructor(private readonly operations:OperationsService){}
  @Get('audit')async audit(@Req() request:AuthenticatedRequest){return result(await this.operations.audit(request.user!.id));}
  @Get('failure-alerts')async failures(@Req() request:AuthenticatedRequest){return result(await this.operations.failures(request.user!.id));}
}
