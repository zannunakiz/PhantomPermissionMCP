# Local monitoring (optional, Step 52)

Prometheus + Grafana for local development only. The core app has zero
dependency on this stack — it works fully with monitoring stopped.

## Start

```bash
# 1. Run the app on the host first (default PORT=3000)
npm run start:dev

# 2. Start monitoring (opt-in profile; does nothing by default)
docker compose -f docker-compose.monitoring.yml --profile monitoring up -d
```

| Service    | URL                   | Notes                              |
| ---------- | --------------------- | ---------------------------------- |
| Prometheus | http://localhost:9090 | Scrapes the app's `GET /metrics`   |
| Grafana    | http://localhost:3001 | Login `admin` / `admin`            |
| Dashboard  | PhantomPermissionMCP → Overview | Request rate, latency, errors, simulations |

## Disable / reset

```bash
docker compose -f docker-compose.monitoring.yml --profile monitoring down
# Full reset including stored metrics/dashboards:
docker compose -f docker-compose.monitoring.yml --profile monitoring down -v
```

## Persistence

- `prometheus-data` volume: scraped time series. Delete via `down -v`.
- `grafana-data` volume: users, settings. Starter dashboard itself is a
  provisioned file (`monitoring/grafana/dashboards/`), so it reappears
  even after a volume reset.

## Customisation

- App on a different host/port: edit the target in
  `monitoring/prometheus.yml` (`host.docker.internal:3000`).
- `GET /metrics` can be turned off with `METRICS_ENABLED=false`; the
  monitoring stack then simply shows no data — the app is unaffected.
- Never expose this stack (or `/metrics`) to the public internet without
  authentication; it is a local-dev tool.
