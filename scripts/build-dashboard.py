#!/usr/bin/env python3
"""Generate the DocuFlow Splunk dashboard (Simple XML) and its query list from one panel definition."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parents[1]

def norm(fields):
    return 'spath | foreach ' + fields + ' [ eval <<FIELD>>=mvindex(<<FIELD>>,0) ]'

JOBS = 'index=container_logs sourcetype="docuflow:application" (upload_received OR upload_rejected OR job_queued OR job_started OR job_completed OR job_failed) | ' + norm('event job_id job_status file_type demo failure_reason failure_stage processing_duration_ms queue_time_ms file_name service') + ' | where isnotnull(event)'
REQUESTS = 'index=container_logs sourcetype="docuflow:application" duration_ms NOT observability | ' + norm('status duration_ms method path service') + ' | where isnotnull(status) AND isnotnull(duration_ms) AND NOT like(path,"/api/observability%")'
# CPU only from samples with online_cpus: older agent builds produced impossible values after container restarts.
CONTAINERS = 'index=container_metrics sourcetype="docuflow:container_metrics" | ' + norm('container_name container_status restart_count online_cpus cpu_percent memory_usage_mb memory_percent network_rx_rate_bytes_per_second network_tx_rate_bytes_per_second') + ' | eval cpu_percent=if(isnull(online_cpus),null(),cpu_percent)'
COMPLETED_MS = 'if(event="job_completed",processing_duration_ms,null())'
STARTED_QUEUE = 'if(event="job_started",queue_time_ms,null())'

ROWS = [
    [
        ('Jobs created', 'single', JOBS + ' | where event="job_queued" | stats count AS Jobs', {}),
        ('Jobs completed', 'single', JOBS + ' | where event="job_completed" | stats count AS Completed', {}),
        ('Jobs failed', 'single', JOBS + ' | where event="job_failed" | stats count AS Failed', {}),
        ('Failure rate', 'single', JOBS + ' | stats count(eval(event="job_completed")) AS ok count(eval(event="job_failed")) AS failed | eval Rate=if(ok+failed>0,round(100*failed/(ok+failed),1),0) | fields Rate', {'unit': '%'}),
        ('Average processing time', 'single', JOBS + ' | stats avg(eval(' + COMPLETED_MS + ')) AS Average | eval Average=round(Average,1)', {'unit': 'ms'}),
        ('P95 processing time', 'single', JOBS + ' | stats perc95(eval(' + COMPLETED_MS + ')) AS P95 | eval P95=round(P95,1)', {'unit': 'ms'}),
    ],
    [
        ('Jobs created, completed and failed over time', 'chart', JOBS + ' | timechart span=1m count(eval(event="job_queued")) AS Created count(eval(event="job_completed")) AS Completed count(eval(event="job_failed")) AS Failed', {'charting.chart': 'column'}),
        ('Job status distribution', 'chart', JOBS + ' | stats count(eval(event="job_queued")) AS queued count(eval(event="job_started")) AS started count(eval(event="job_completed")) AS COMPLETED count(eval(event="job_failed")) AS FAILED count(eval(event="job_failed" AND failure_stage="processing")) AS failedInWorker | eval QUEUED=max(0,queued-started), PROCESSING=max(0,started-COMPLETED-failedInWorker) | fields QUEUED PROCESSING COMPLETED FAILED | transpose column_name=Status | rename "row 1" AS count | where count>0', {'charting.chart': 'pie'}),
    ],
    [
        ('Average and P95 processing duration (ms)', 'chart', JOBS + ' | timechart span=1m avg(eval(' + COMPLETED_MS + ')) AS Average perc95(eval(' + COMPLETED_MS + ')) AS P95', {'charting.chart': 'line'}),
        ('Queue time: average and P95 (ms)', 'chart', JOBS + ' | timechart span=1m avg(eval(' + STARTED_QUEUE + ')) AS Average perc95(eval(' + STARTED_QUEUE + ')) AS P95', {'charting.chart': 'line'}),
    ],
    [
        ('Most common failure reasons', 'chart', JOBS + ' | where event="job_failed" | stats count AS Failures BY failure_reason | sort - Failures', {'charting.chart': 'bar'}),
        ('File type distribution', 'chart', JOBS + ' | where event="upload_received" OR (event="job_queued" AND isnotnull(demo)) | stats count BY file_type', {'charting.chart': 'pie'}),
    ],
    [
        ('API and worker CPU (%)', 'chart', CONTAINERS + ' | timechart span=30s avg(cpu_percent) BY container_name', {'charting.chart': 'line'}),
        ('API and worker memory (MB)', 'chart', CONTAINERS + ' | timechart span=30s avg(memory_usage_mb) BY container_name', {'charting.chart': 'line'}),
    ],
    [
        ('Container status and restart count', 'table', CONTAINERS + ' | stats latest(container_status) AS Status latest(restart_count) AS Restarts latest(_time) AS LastSeen BY container_name | eval LastSeen=strftime(LastSeen,"%Y-%m-%d %H:%M:%S") | rename container_name AS Container', {}),
        ('Restart count over time', 'chart', CONTAINERS + ' | timechart span=30s max(restart_count) BY container_name', {'charting.chart': 'line'}),
    ],
    [
        ('Network throughput (bytes/s)', 'chart', CONTAINERS + ' | eval Throughput=network_rx_rate_bytes_per_second+network_tx_rate_bytes_per_second | timechart span=30s avg(Throughput) BY container_name', {'charting.chart': 'area'}),
        ('API response time excl. Splunk proxy: average and P95 (ms)', 'chart', REQUESTS + ' | timechart span=1m avg(duration_ms) AS Average perc95(duration_ms) AS P95', {'charting.chart': 'line'}),
    ],
    [
        ('Recent job failures', 'table', JOBS + ' | where event="job_failed" | sort - _time | head 20 | eval Time=strftime(_time,"%H:%M:%S") | table Time job_id file_name failure_stage failure_reason', {}),
        ('Slowest jobs', 'table', JOBS + ' | where event="job_completed" | sort - processing_duration_ms | head 10 | table job_id file_name file_type queue_time_ms processing_duration_ms', {}),
    ],
]

def panel(title, kind, query, options):
    opts = ''.join(f'\n        <option name="{name}">{escape(value)}</option>' for name, value in {'drilldown': 'none', **options}.items())
    return f'''    <panel>
      <title>{escape(title)}</title>
      <{kind}>
        <search>
          <query>{escape(query)}</query>
          <earliest>$window.earliest$</earliest>
          <latest>$window.latest$</latest>
          <refresh>30s</refresh>
          <refreshType>delay</refreshType>
        </search>{opts}
      </{kind}>
    </panel>'''

rows = '\n'.join('  <row>\n' + '\n'.join(panel(*p) for p in row) + '\n  </row>' for row in ROWS)
xml = f'''<form version="1.1" theme="dark">
  <label>DocuFlow | File Processing Observability</label>
  <description>Jobs, processing and queue time, failure reasons, and API/worker container health. Refreshes every 30 seconds. Demo jobs (/api/demo/*) appear here as controlled evidence.</description>
  <fieldset submitButton="false">
    <input type="time" token="window" searchWhenChanged="true">
      <label>Time range</label>
      <default>
        <earliest>-1h</earliest>
        <latest>now</latest>
      </default>
    </input>
  </fieldset>
{rows}
</form>
'''
(root / 'splunk/docuflow_dashboard.xml').write_text(xml)
(root / 'splunk/dashboard_queries.json').write_text(json.dumps([{'title': p[0], 'query': p[2]} for row in ROWS for p in row], indent=2) + '\n')
print('Wrote splunk/docuflow_dashboard.xml and splunk/dashboard_queries.json')
