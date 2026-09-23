import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MediaModule } from './media/media.module';
import { OperationsModule } from './operations/operations.module';
import { KakaoChannelModule } from './kakao-channel/kakao-channel.module';
import { HealthController } from './health/health.controller';
import { PostsModule } from './posts/posts.module';
import { PublishingModule } from './publishing/publishing.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { RuntimeModule } from './runtime/runtime.module';

@Module({
  imports: [RuntimeModule, AuthModule, CampaignsModule, MediaModule, PostsModule, PublishingModule, AnalyticsModule, SchedulerModule, KakaoChannelModule, OperationsModule],
  controllers: [HealthController],
})
export class AppModule {}
