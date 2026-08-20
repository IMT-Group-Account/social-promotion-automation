import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { readonly data: { readonly status: 'ok' }; readonly error: null; readonly meta: Record<string, never> } {
    return { data: { status: 'ok' }, error: null, meta: {} };
  }
}
