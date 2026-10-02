# EventPulse

EventPulse is a containerized event-registration app with structured JSON logs, real Docker runtime metrics, Splunk HEC integration, and a Jenkins delivery pipeline.

## Run locally with a directly installed Splunk Enterprise instance

1. Copy `.env.example` to `.env` and set strong Splunk values. Never commit this file.
2. In Splunk Web (`http://localhost:8000`), create `container_logs` and `container_metrics` indexes, enable HEC on 8088, and create `eventpulse-logs` and `eventpulse-metrics` tokens.
3. Set `SPLUNK_HEC_URL=https://127.0.0.1:8088/services/collector/event` and the tokens in `.env`. For the default self-signed local Splunk certificate set `SPLUNK_HEC_INSECURE_TLS=true`; use `false` with a trusted certificate.
4. Build the browser UI with `cd client; npm ci; npm run build`, then run `cd ../server; npm ci; npm start` and visit `http://localhost:3000`.

The optional Docker Compose configuration remains available for container demonstrations. Docker socket access granted to its metrics agent is privileged and intended only for the controlled academic environment.

## Development and tests

```sh
cd server && npm ci && npm test
cd ../client && npm ci && npm run build
```

Tests use a brand-new in-memory SQLite database and never touch the production database. For local execution, set `DATABASE_PATH=server/data/eventpulse.db` if you want the SQLite file under the repository; the default Docker path remains `/app/data/eventpulse.db`.

## Splunk dashboard searches

Create **EventPulse Container Observability Dashboard** with these panels:

| Panel | Search |
| --- | --- |
| Requests Over Time | `index=container_logs \| spath \| timechart span=1m count AS requests` |
| HTTP Status Distribution | `index=container_logs \| spath \| chart count BY status` |
| Errors by Route | `index=container_logs \| spath \| where status >= 400 \| stats count AS errors BY path, status \| sort - errors` |
| Slow Requests | `index=container_logs \| spath \| where duration_ms > 1000 \| table _time method path status duration_ms request_id` |
| Average and P95 Response Time | `index=container_logs \| spath \| timechart span=1m avg(duration_ms) AS average_ms perc95(duration_ms) AS p95_ms` |
| Container CPU and Memory | `index=container_metrics metric_type=container_stats \| spath \| timechart span=30s avg(cpu_percent) AS avg_cpu_percent avg(memory_percent) AS avg_memory_percent` |
| Container State and Restarts | `index=container_metrics metric_type=container_stats \| spath \| table _time container_name container_status restart_count` |
| Network Throughput | `index=container_metrics metric_type=container_stats \| spath \| timechart span=30s avg(network_rx_rate_bytes_per_second) AS rx_bytes_per_sec avg(network_tx_rate_bytes_per_second) AS tx_bytes_per_sec` |

Alert: `index=container_logs | spath | where status >= 500 | stats count AS server_errors`, trigger if more than 2 errors occur in 5 minutes (High).

## Jenkins

Set a GitHub push webhook to Jenkins and configure credentials IDs `splunk-hec-token` and `splunk-metrics-hec-token`. The Jenkinsfile installs dependencies, tests before any image build/deployment, creates a masked temporary `.env`, deploys, health-checks for 60 seconds, then removes it. Configure an admin-managed Splunk `.env` on the deployment host separately if its service is included.

Demo observability routes are intentionally available only when `DEMO_MODE=true`: `/api/demo/slow` takes 3 seconds and `/api/demo/error` produces a controlled 500. Use them only for demonstrations.
