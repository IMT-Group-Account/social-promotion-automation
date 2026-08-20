import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [AnalyticsModule], providers: [SchedulerService], exports: [SchedulerService] })
export class SchedulerModule {}
