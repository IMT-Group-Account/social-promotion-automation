import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { type SocialPublishJob } from '../posts/post.entity';

@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private collecting = false;

  constructor(private readonly analytics: AnalyticsService) {}

  due(jobs: readonly SocialPublishJob[], now = new Date()): readonly SocialPublishJob[] {
    return jobs.filter((job) => job.status === 'waiting' && job.scheduledAt <= now);
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.analyticsIntervalMs();
    if (intervalMs === null) return;
    this.timer = setInterval(() => { void this.collectAnalytics(); }, intervalMs);
    void this.collectAnalytics();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async collectAnalytics(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const result = await this.analytics.collectDue();
      if (result.failed.length > 0) this.logger.warn(`Analytics collection completed with ${result.failed.length} failed platform job(s).`);
    } catch (error) {
      this.logger.error('Scheduled analytics collection could not start.', error instanceof Error ? error.stack : undefined);
    } finally { this.collecting = false; }
  }

  private analyticsIntervalMs(): number | null {
    const raw = process.env.ANALYTICS_COLLECTION_INTERVAL_MS;
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 60_000 || value > 24 * 60 * 60 * 1000) {
      throw new RangeError('ANALYTICS_COLLECTION_INTERVAL_MS must be between one minute and one day.');
    }
    return value;
  }
}
