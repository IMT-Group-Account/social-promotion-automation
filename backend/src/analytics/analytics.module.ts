import { Module } from '@nestjs/common';
import { PublishingModule } from '../publishing/publishing.module';
import { AnalyticsController } from './analytics.controller';
import { ANALYTICS_REPOSITORY } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { PgAnalyticsRepository } from './pg-analytics.repository';

@Module({
  imports: [PublishingModule], controllers: [AnalyticsController],
  providers: [AnalyticsService, PgAnalyticsRepository, { provide: ANALYTICS_REPOSITORY, useExisting: PgAnalyticsRepository }],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
