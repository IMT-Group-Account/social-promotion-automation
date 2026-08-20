import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PostController } from './post.controller';
import { InMemoryPostRepository, POST_REPOSITORY } from './post.repository';
import { PostService } from './post.service';

@Module({
  imports: [MediaModule, CampaignsModule, AnalyticsModule],
  controllers: [PostController],
  providers: [PostService, { provide: POST_REPOSITORY, useClass: InMemoryPostRepository }],
  exports: [PostService, POST_REPOSITORY],
})
export class PostsModule {}
