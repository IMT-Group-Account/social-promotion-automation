import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { FACEBOOK_CREDENTIAL_RESOLVER, FacebookCredentialService } from './adapters/facebook-credential.service';
import { FACEBOOK_HTTP_CLIENT, FetchFacebookHttpClient } from './adapters/facebook-http.client';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { INSTAGRAM_CREDENTIAL_RESOLVER, InstagramCredentialService } from './adapters/instagram-credential.service';
import { FetchInstagramHttpClient, INSTAGRAM_HTTP_CLIENT } from './adapters/instagram-http.client';
import { LinkedInAdapter } from './adapters/linkedin.adapter';
import { LINKEDIN_CREDENTIAL_RESOLVER, LinkedInCredentialService } from './adapters/linkedin-credential.service';
import { FetchLinkedInHttpClient, LINKEDIN_HTTP_CLIENT } from './adapters/linkedin-http.client';
import { SOCIAL_ADAPTERS } from './adapters/social-adapter.interface';
import { ThreadsAdapter } from './adapters/threads.adapter';
import { THREADS_CREDENTIAL_RESOLVER, ThreadsCredentialService } from './adapters/threads-credential.service';
import { FetchThreadsHttpClient, THREADS_HTTP_CLIENT } from './adapters/threads-http.client';
import { XAdapter } from './adapters/x.adapter';
import { X_CREDENTIAL_RESOLVER, XCredentialService } from './adapters/x-credential.service';
import { FetchXHttpClient, X_HTTP_CLIENT } from './adapters/x-http.client';
import { FetchXMediaSource, X_MEDIA_SOURCE } from './adapters/x-media-source.service';
import { FormatterService } from './formatter.service';
import { BullMqPublishQueue } from './bullmq-publish.queue';
import { BullMqPublishWorker } from './bullmq-publish.worker';
import { FacebookContentFormatter } from './formatters/facebook-content.formatter';
import { InstagramContentFormatter } from './formatters/instagram-content.formatter';
import { LinkedInContentFormatter } from './formatters/linkedin-content.formatter';
import { PLATFORM_CONTENT_FORMATTERS } from './formatters/platform-content.interface';
import { ThreadsContentFormatter } from './formatters/threads-content.formatter';
import { XContentFormatter } from './formatters/x-content.formatter';
import { PublishingQueue } from './publishing.queue';
import { PublishingService } from './publishing.service';
import { PUBLISH_OUTBOX_REPOSITORY } from './publish-outbox.repository';
import { PUBLISH_QUEUE_PORT } from './publish-queue.port';
import { PgPublishOutboxRepository } from './pg-publish-outbox.repository';
import { PublishWorkerProcessor } from './publish-worker.processor';
import { PgXUsageLedger, X_USAGE_LEDGER, XApiCostService } from './x-api-usage.service';

@Module({
  imports: [AuthModule],
  providers: [
    FormatterService, PublishingService, PublishingQueue, PublishWorkerProcessor, BullMqPublishWorker, BullMqPublishQueue, PgPublishOutboxRepository,
    LinkedInContentFormatter, InstagramContentFormatter, FacebookContentFormatter, ThreadsContentFormatter, XContentFormatter,
    LinkedInCredentialService, FetchLinkedInHttpClient, FacebookCredentialService, FetchFacebookHttpClient, InstagramCredentialService, FetchInstagramHttpClient, ThreadsCredentialService, FetchThreadsHttpClient,
    XCredentialService, FetchXHttpClient, FetchXMediaSource, PgXUsageLedger, XApiCostService,
    LinkedInAdapter, FacebookAdapter, InstagramAdapter, ThreadsAdapter, XAdapter,
    { provide: LINKEDIN_CREDENTIAL_RESOLVER, useExisting: LinkedInCredentialService },
    { provide: LINKEDIN_HTTP_CLIENT, useExisting: FetchLinkedInHttpClient },
    { provide: FACEBOOK_CREDENTIAL_RESOLVER, useExisting: FacebookCredentialService },
    { provide: FACEBOOK_HTTP_CLIENT, useExisting: FetchFacebookHttpClient },
    { provide: INSTAGRAM_CREDENTIAL_RESOLVER, useExisting: InstagramCredentialService },
    { provide: INSTAGRAM_HTTP_CLIENT, useExisting: FetchInstagramHttpClient },
    { provide: THREADS_CREDENTIAL_RESOLVER, useExisting: ThreadsCredentialService },
    { provide: THREADS_HTTP_CLIENT, useExisting: FetchThreadsHttpClient },
    { provide: X_CREDENTIAL_RESOLVER, useExisting: XCredentialService },
    { provide: X_HTTP_CLIENT, useExisting: FetchXHttpClient },
    { provide: X_MEDIA_SOURCE, useExisting: FetchXMediaSource },
    { provide: X_USAGE_LEDGER, useExisting: PgXUsageLedger },
    { provide: PUBLISH_OUTBOX_REPOSITORY, useExisting: PgPublishOutboxRepository },
    { provide: PUBLISH_QUEUE_PORT, useExisting: BullMqPublishQueue },
    {
      provide: PLATFORM_CONTENT_FORMATTERS,
      useFactory: (linkedin: LinkedInContentFormatter, instagram: InstagramContentFormatter, facebook: FacebookContentFormatter, threads: ThreadsContentFormatter, x: XContentFormatter) =>
        [linkedin, instagram, facebook, threads, x],
      inject: [LinkedInContentFormatter, InstagramContentFormatter, FacebookContentFormatter, ThreadsContentFormatter, XContentFormatter],
    },
    {
      provide: SOCIAL_ADAPTERS,
      useFactory: (linkedin: LinkedInAdapter, facebook: FacebookAdapter, instagram: InstagramAdapter, threads: ThreadsAdapter, x: XAdapter) =>
        [linkedin, facebook, instagram, threads, x],
      inject: [LinkedInAdapter, FacebookAdapter, InstagramAdapter, ThreadsAdapter, XAdapter],
    },
  ],
  exports: [PublishingService, PublishingQueue, BullMqPublishWorker, SOCIAL_ADAPTERS],
})
export class PublishingModule {}
