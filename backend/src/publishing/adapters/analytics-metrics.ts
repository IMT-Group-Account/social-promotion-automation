import type { PostAnalytics } from './social-adapter.interface';

export function numericProviderMetrics(payload: Readonly<Record<string, unknown>>): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) metrics[name] = value;
  }
  return metrics;
}

export function assertAnalyticsHaveValues(metrics: PostAnalytics, provider: string): PostAnalytics {
  const standardMetrics = [
    metrics.impressions, metrics.reach, metrics.views, metrics.likes,
    metrics.comments, metrics.shares, metrics.reposts, metrics.clicks,
  ];
  if (standardMetrics.some((value) => value !== undefined) || Object.keys(metrics.rawMetrics ?? {}).length > 0) return metrics;
  throw new TypeError(`${provider} analytics response has no numeric metrics.`);
}
