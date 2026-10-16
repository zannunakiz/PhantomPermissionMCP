import { MetricsService, normaliseRoute } from './metrics.service';

/** Step 50 validation: counters, histograms, cardinality guard. */
describe('MetricsService', () => {
  it('counts requests, errors, and simulations', () => {
    const m = new MetricsService();
    m.resetForTests();
    m.observeHttp('GET', '/api/v1/models', 200, 50);
    m.observeHttp('GET', '/api/v1/models', 500, 10);
    m.observeHttp('POST', '/api/v1/simulations', 201, 100);
    m.observeHttp('POST', '/api/v1/models', 400, 5);
    const out = m.render();
    expect(out).toContain('http_requests_total');
    expect(out).toContain('http_errors_total');
    expect(out).toContain('http_request_duration_seconds_bucket');
    expect(out).toContain('validation_failures_total 1');
    expect(out).toContain('simulations_total 1');
    expect(out).toContain('db_up 1');
  });

  it('never emits raw ids or secrets as labels', () => {
    const m = new MetricsService();
    m.resetForTests();
    m.observeHttp(
      'GET',
      normaliseRoute('/api/v1/models/550e8400-e29b-41d4-a716-446655440000'),
      200,
      5,
    );
    m.observeHttp(
      'GET',
      normaliseRoute('/api/v1/simulations/sim_abc123XYZ'),
      200,
      5,
    );
    const out = m.render();
    expect(out).not.toContain('550e8400');
    expect(out).not.toContain('sim_abc123XYZ');
    expect(out).toContain(':id');
  });

  it('tracks db health gauge', () => {
    const m = new MetricsService();
    m.resetForTests();
    m.setDbUp(false);
    expect(m.render()).toContain('db_up 0');
  });
});
