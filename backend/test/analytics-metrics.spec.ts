import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAnalyticsHaveValues, numericProviderMetrics } from '../src/publishing/adapters/analytics-metrics';

test('preserves provider-native numeric metrics without inventing unavailable common metrics', () => {
  const rawMetrics = numericProviderMetrics({ impression_count: 300, repost_count: 12, unavailable: null, label: 'not-a-number', invalid: -1 });
  const metrics = assertAnalyticsHaveValues({ impressions: 300, reposts: 12, rawMetrics, capturedAt: new Date('2026-08-24T00:00:00Z') }, 'X');

  assert.deepEqual(rawMetrics, { impression_count: 300, repost_count: 12 });
  assert.equal(metrics.clicks, undefined);
  assert.deepEqual(metrics, { impressions: 300, reposts: 12, rawMetrics, capturedAt: new Date('2026-08-24T00:00:00Z') });
});

test('rejects a provider response that contains no numeric metric at all', () => {
  assert.throws(
    () => assertAnalyticsHaveValues({ rawMetrics: {}, capturedAt: new Date('2026-08-24T00:00:00Z') }, 'X'),
    /no numeric metrics/,
  );
});
