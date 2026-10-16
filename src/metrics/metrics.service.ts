import { Injectable } from '@nestjs/common';

/** Step 50 — in-memory Prometheus metrics (zero new dependencies). */
export const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function bucketIndex(seconds: number): number {
  for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
    if (seconds <= DURATION_BUCKETS[i]) return i;
  }
  return DURATION_BUCKETS.length; // +Inf
}

/** Collapse dynamic segments so raw IDs never become label values. */
export function normaliseRoute(templateOrPath: string): string {
  if (!templateOrPath) return 'unknown';
  const q = templateOrPath.indexOf('?');
  const clean = q >= 0 ? templateOrPath.slice(0, q) : templateOrPath;
  return clean
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{7,}/gi, ':id')
    .replace(/\b\d+\b/g, ':id')
    .replace(/sim_[A-Za-z0-9_-]{1,120}/g, ':id');
}

@Injectable()
export class MetricsService {
  private httpCounts = new Map<string, number>();
  private httpErrors = new Map<string, number>();
  private httpSums = new Map<string, number>();
  private httpBuckets = new Map<string, number[]>();
  private validationFailures = 0;
  private simulationCount = 0;
  private simulationSum = 0;
  private simulationBuckets: number[] = Array.from(
    { length: DURATION_BUCKETS.length + 1 },
    () => 0,
  );
  private dbUp: 0 | 1 = 1;

  resetForTests(): void {
    this.httpCounts.clear();
    this.httpErrors.clear();
    this.httpSums.clear();
    this.httpBuckets.clear();
    this.validationFailures = 0;
    this.simulationCount = 0;
    this.simulationSum = 0;
    this.simulationBuckets = Array.from(
      { length: DURATION_BUCKETS.length + 1 },
      () => 0,
    );
    this.dbUp = 1;
  }

  /** Route must already be normalised. */
  observeHttp(
    method: string,
    route: string,
    status: number,
    durationMs: number,
  ): void {
    const cls = `${Math.floor(status / 100)}xx`;
    const key = `${method}|${route}|${cls}`;
    this.httpCounts.set(key, (this.httpCounts.get(key) ?? 0) + 1);
    const s = Math.max(0, durationMs / 1000);
    this.httpSums.set(key, (this.httpSums.get(key) ?? 0) + s);
    let b = this.httpBuckets.get(key);
    if (!b) {
      b = new Array(DURATION_BUCKETS.length + 1).fill(0);
      this.httpBuckets.set(key, b);
    }
    b[bucketIndex(s)] += 1;
    if (status >= 500)
      this.httpErrors.set(key, (this.httpErrors.get(key) ?? 0) + 1);
    if (status === 400 || status === 422) this.validationFailures += 1;
    if (method === 'POST' && route.includes('/simulations') && status < 300) {
      this.incSimulation(durationMs);
    }
  }

  incSimulation(durationMs: number): void {
    const s = Math.max(0, durationMs / 1000);
    this.simulationCount += 1;
    this.simulationSum += s;
    this.simulationBuckets[bucketIndex(s)] += 1;
  }

  incValidationFailure(): void {
    this.validationFailures += 1;
  }

  setDbUp(up: boolean): void {
    this.dbUp = up ? 1 : 0;
  }

  /** Prometheus text exposition format. */
  render(): string {
    const L: string[] = [];
    L.push('# HELP http_requests_total Total HTTP requests.');
    L.push('# TYPE http_requests_total counter');
    for (const [k, v] of this.httpCounts) {
      const [m, r, s] = k.split('|');
      L.push(
        `http_requests_total{method="${m}",route="${r}",status="${s}"} ${v}`,
      );
    }
    L.push('# HELP http_errors_total Total HTTP 5xx responses.');
    L.push('# TYPE http_errors_total counter');
    for (const [k, v] of this.httpErrors) {
      const [m, r, s] = k.split('|');
      L.push(
        `http_errors_total{method="${m}",route="${r}",status="${s}"} ${v}`,
      );
    }
    L.push('# HELP http_request_duration_seconds HTTP request latency.');
    L.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, b] of this.httpBuckets) {
      const [m, r, s] = k.split('|');
      const lb = `method="${m}",route="${r}",status="${s}"`;
      let c = 0;
      for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
        c += b[i];
        L.push(
          `http_request_duration_seconds_bucket{${lb},le="${DURATION_BUCKETS[i]}"} ${c}`,
        );
      }
      c += b[DURATION_BUCKETS.length];
      L.push(`http_request_duration_seconds_bucket{${lb},le="+Inf"} ${c}`);
      L.push(
        `http_request_duration_seconds_sum{${lb}} ${this.httpSums.get(k) ?? 0}`,
      );
      L.push(
        `http_request_duration_seconds_count{${lb}} ${this.httpCounts.get(k) ?? 0}`,
      );
    }
    L.push('# HELP validation_failures_total Total validation failures.');
    L.push('# TYPE validation_failures_total counter');
    L.push(`validation_failures_total ${this.validationFailures}`);
    L.push('# HELP simulations_total Total successful simulations.');
    L.push('# TYPE simulations_total counter');
    L.push(`simulations_total ${this.simulationCount}`);
    L.push('# HELP db_up Whether the last readiness probe succeeded.');
    L.push('# TYPE db_up gauge');
    L.push(`db_up ${this.dbUp}`);
    return `${L.join('\n')}\n`;
  }
}
