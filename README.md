# DocuFlow

**Container monitoring and log analysis of a file processing service using Docker, Jenkins and Splunk.**

Users upload a `.csv` or `.txt` file. The API container validates it and creates a job with status `QUEUED`. A separate worker container claims the job and processes the file, then records the result. Both containers send structured logs to Splunk, and a metrics agent streams their CPU, memory, network and restart count.

```
Browser ──upload──▶ docuflow-api ──QUEUED job──▶ shared volume (SQLite + uploads) ◀──claims── docuflow-worker
                         │                                                                │
                         └────────── JSON logs (HEC) ──▶ Splunk ◀── JSON logs (HEC) ──────┘
                                                           ▲
                         docuflow-metrics-agent ── Docker stats for api + worker
```

## What it does

| | |
| --- | --- |
| File types | `.csv` and `.txt` only, at most 5 MB |
| Job states | `QUEUED → PROCESSING → COMPLETED` or `FAILED` |
| CSV result | row count, column count, header names, missing-value count, duplicate-row count, processing duration |
| TXT result | line count, word count, character count, top five repeated words |
| Failure reasons | `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE` (rejected by the API), `EMPTY_FILE`, `MALFORMED_CSV`, `CORRUPTED_FILE`, `DEMO_INTENTIONAL_FAILURE`, `WORKER_RESTARTED` (failed by the worker) |

Uploading `attendance.csv` (3 rows, one blank cell, one repeated row) returns:

```json
{ "jobId": "JOB-1001", "status": "COMPLETED", "fileName": "attendance.csv", "fileType": "csv",
  "rowCount": 3, "columnCount": 3, "headers": ["name", "roll_no", "attendance"],
  "missingValues": 1, "duplicateRows": 1, "queueTimeMs": 571, "processingDurationMs": 2.13 }
```

Rejected uploads are still recorded as `FAILED` jobs with `failureStage: "validation"`, so every failure reason shows up in the job list and in Splunk.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/jobs` | Upload a file (multipart field `file`). `201` queued, `415` wrong type, `413` over 5 MB |
| `GET` | `/api/jobs?status=&limit=&offset=` | List jobs, newest first |
| `GET` | `/api/jobs/stats` | Counts by status, average timings, worker heartbeat |
| `GET` | `/api/jobs/JOB-1042` | One job with its results |
| `GET` | `/api/health` | API, database and worker status (used by Docker and Jenkins) |
| `POST` | `/api/demo/fail-job` | Queues a job the worker fails on purpose |
| `POST` | `/api/demo/slow-job` | Queues a job that takes `DEMO_SLOW_JOB_MS` (8 s), so the jobs behind it build queue time |
| `POST` | `/api/demo/crash-worker` | Queues a job that makes the worker exit; Docker restarts it and the restart count rises |
| `GET` | `/api/observability/summary?range=` | Splunk-backed data for the in-app dashboard |
| `GET` | `/api/observability/logs?range=&level=&service=&q=` | Splunk-backed log search |

The demo routes exist only when `DEMO_MODE=true`.

## Log events

Every stage writes one JSON log line with an `event` field. `job_id` ties together the events for one job across the two containers.

| Event | Container | Key fields |
| --- | --- | --- |
| `upload_received` | API | `file_name`, `file_type`, `file_size_bytes` |
| `upload_rejected` | API | `failure_reason` |
| `job_queued` | API | `job_id`, `job_status=QUEUED` |
| `job_started` | worker | `queue_time_ms`, `queue_depth` |
| `job_completed` | worker | `processing_duration_ms`, `row_count`/`column_count`/`missing_values`/`duplicate_rows` or `line_count`/`word_count`/`character_count` |
| `job_failed` | API or worker | `failure_stage`, `failure_reason`, `failure_message` |
| `worker_started` | worker | `recovered_jobs` (jobs it failed with `WORKER_RESTARTED` after a crash) |
| `worker_crash_simulated` | worker | logged just before the crash demo exits |

Every HTTP request also logs `method`, `path`, `status` and `duration_ms`. Logs go to index `container_logs` (sourcetype `docuflow:application`). Container and process metrics go to `container_metrics`.

## Run it

### 1. Splunk

Use a local Splunk install, or run `docker compose -f compose.splunk.yaml up -d`. Copy `.env.example` to `.env` and set the admin password and two HEC token values, then run:

```sh
python3 scripts/configure-splunk.py        # indexes container_logs + container_metrics, HEC inputs on 8088
python3 scripts/configure-splunk-rest.py   # read-only search user + 90-day REST token for the in-app dashboard
python3 scripts/deploy-dashboard.py        # installs the Splunk dashboard and checks every panel search runs
```

### 2. The stack (Docker)

```sh
docker compose up -d --build
```

This starts `docuflow-api` (http://localhost:3000), `docuflow-worker` and `docuflow-metrics-agent`. The API and worker share the `docuflow-data` volume, which holds the SQLite database and the uploads. Containers reach Splunk at `host.docker.internal`. Set `DOCKER_SPLUNK_HEC_URL` / `DOCKER_SPLUNK_REST_URL` in `.env` if Splunk runs elsewhere.

The metrics agent mounts the Docker socket read-only. That gives it privileged access, which is acceptable only in this controlled lab environment.

### Without Docker

```sh
cd client && npm ci && npm run build
cd ../server && npm ci
npm start              # API on :3000
npm run worker         # in a second terminal
```

Locally the database and uploads live in `server/data/`, and the dashboard's CPU/memory panels use process metrics instead of container stats.

### Troubleshooting: "No worker running" or "Worker offline"

- **Local `npm start` and Docker both claim port 3000.** Whichever starts first owns the port, and the other is silently unreachable. A local API only sees a worker if you also run `npm run worker`, so use one setup at a time. To go back to Docker, stop the local server and run `docker compose up -d --force-recreate api`.
- **Local runs share whatever `DATABASE_PATH` is set in `.env`.** The API and worker must use the same file. Remove an old `DATABASE_PATH` line to use the default `server/data/docuflow.db`.
- **Run `docker compose` from the project root.** Compose reads `.env` from the directory you run it in. Run it inside `server/` and it picks up `server/.env`, whose tokens may be stale. Symptoms: the dashboard shows `SPLUNK_AUTH_FAILED` (HTTP 401), or `docker logs docuflow-metrics-agent` shows `HEC returned status 403`. The setup scripts renew only the root `.env`.
- **In Docker**, run `docker compose ps`. The worker should be `healthy`, and `docker logs docuflow-worker` shows its `worker_started` event.

## Demo script for Splunk evidence

1. Upload a valid CSV and a TXT file. Then upload a `.pdf`, an empty `.txt`, and a CSV with a short row (`a,b` then `1`).
2. Click **Slow job** and immediately upload two more files. Their queue time jumps to about 8 s.
3. Click **Failed job**.
4. Click **Crash worker**. `docker inspect -f '{{.RestartCount}}' docuflow-worker` goes up by one, the interrupted job becomes `FAILED / WORKER_RESTARTED`, and the Splunk restart panel shows it.

## Dashboards

- **In the app**: `/dashboard` (jobs, failure reasons, P95 processing and queue time, API vs worker CPU/memory, container restarts) and `/logs` (searchable by job ID, service, level and status).
- **In Splunk**: *DocuFlow | File Processing Observability*, generated from `scripts/build-dashboard.py` into `splunk/docuflow_dashboard.xml`. Its panels are listed in `splunk/dashboard_queries.json`.

| Panel | Search (abbreviated) |
| --- | --- |
| Jobs created / completed / failed over time | `timechart count(eval(event="job_queued")) count(eval(event="job_completed")) count(eval(event="job_failed"))` |
| Average and P95 processing duration | `timechart avg(processing_duration_ms) perc95(processing_duration_ms)` on `job_completed` |
| Queue time | `timechart avg(queue_time_ms) perc95(queue_time_ms)` on `job_started` |
| Job-status distribution | furthest state reached per `job_id`, then `stats count BY Status` |
| Most common failure reasons | `where event="job_failed" \| stats count BY failure_reason` |
| File-type distribution | `where event="upload_received" \| stats count BY file_type` |
| API and worker CPU / memory | `index=container_metrics \| timechart avg(cpu_percent) BY container_name` |
| Container restart count and status | `stats latest(container_status) latest(restart_count) BY container_name` |

Suggested alert: `index=container_logs event=job_failed | stats count`. Trigger when there are more than 5 failures in 5 minutes.

## Jenkins

Set a GitHub push webhook to Jenkins, then add secret-text credentials `splunk-hec-token` and `splunk-metrics-hec-token`. The pipeline runs these stages:

1. **Install** client and server dependencies.
2. **Run Tests**: server Jest suite (API, worker, CSV/TXT processor, Splunk queries; at least 80% statement coverage) and a client build. A failure stops the pipeline before any image is built.
3. **Build Docker Images**: `docuflow-api`, `docuflow-worker` and `docuflow-metrics-agent`, tagged `1.0.<build>`.
4. **Deploy** with `docker compose up -d`, using a temporary masked `.env`.
5. **Verify Deployment**: waits until `/api/health` reports the worker `online`.
6. **Smoke Test**: uploads a CSV and waits for the job to reach `COMPLETED`, which proves the API → worker path end to end.

## Tests

```sh
cd server && npm test
```

Tests use in-memory SQLite and temporary upload folders. They never touch `server/data`.
