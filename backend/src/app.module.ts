import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MediaModule } from './media/media.module';
import { KakaoChannelModule } from './kakao-channel/kakao-channel.module';
import { HealthController } from './health/health.controller';
import { PostsModule } from './posts/posts.module';
import { PublishingModule } from './publishing/publishing.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [AuthModule, CampaignsModule, MediaModule, PostsModule, PublishingModule, AnalyticsModule, SchedulerModule, KakaoChannelModule],
  controllers: [HealthController],
})
export class AppModule {}
