import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PostController } from './post.controller';
import { POST_REPOSITORY } from './post.repository';
import { PgPostRepository } from './pg-post.repository';
import { DatabaseService } from '../database/database.service';
import { PostService } from './post.service';

@Module({
  imports: [MediaModule, CampaignsModule, AnalyticsModule],
  controllers: [PostController],
  providers: [PostService, DatabaseService, { provide: POST_REPOSITORY, useClass: PgPostRepository }],
  exports: [PostService, POST_REPOSITORY],
})
export class PostsModule {}
