import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';

test('does not collect analytics until the dedicated scheduler process starts it', async () => {
  const previousInterval = process.env.ANALYTICS_COLLECTION_INTERVAL_MS;
  process.env.ANALYTICS_COLLECTION_INTERVAL_MS = '60000';

  let collections = 0;
  const analytics = {
    collectDue: async () => {
      collections += 1;
      return { collectedJobIds: [], failed: [] };
    },
  } as unknown as AnalyticsService;
  const scheduler = new SchedulerService(analytics);

  try {
    assert.equal(collections, 0);
    scheduler.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(collections, 1);
  } finally {
    scheduler.onModuleDestroy();
    if (previousInterval === undefined) delete process.env.ANALYTICS_COLLECTION_INTERVAL_MS;
    else process.env.ANALYTICS_COLLECTION_INTERVAL_MS = previousInterval;
  }
});
