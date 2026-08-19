export interface DevelopmentMetrics {
  httpRequests: number;
  realtimeApiCalls: number;
  wsMessagesReceived: number;
  wsMessagesSent: number;
  wsReconnects: number;
}

const metrics: DevelopmentMetrics = {
  httpRequests: 0,
  realtimeApiCalls: 0,
  wsMessagesReceived: 0,
  wsMessagesSent: 0,
  wsReconnects: 0,
};

export function incrementDevelopmentMetric(metric: keyof DevelopmentMetrics, amount = 1): void {
  if (!import.meta.env.DEV) return;
  metrics[metric] += amount;
}

export function developmentMetricsSnapshot(): DevelopmentMetrics {
  return { ...metrics };
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    __k0nnectDevelopmentMetrics: {
      reset() {
        for (const metric of Object.keys(metrics) as (keyof DevelopmentMetrics)[]) {
          metrics[metric] = 0;
        }
      },
      snapshot: developmentMetricsSnapshot,
    },
  });
}
