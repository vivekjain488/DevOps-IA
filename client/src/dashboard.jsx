import React, { useEffect, useMemo, useState } from 'react';
import { api, num, fmtInt, fmtMs, fmtAxisMs, fmtPct, fmtBytes, fmtRelative, fmtDate, fmtTime, fmtDay, splunkTime, timeLabel, RANGE_OPTIONS, RANGE_NAMES, useInterval, linkProps } from './lib';
import { Card, PageHeader, Segmented, Stat, Delta, Empty, Skeleton, Icon } from './ui';
import { Sparkline } from './charts';
import { TimeSeriesChart, StackedBarChart, RankingBarChart, DonutChart, LatencyVolumeChart } from './components/dashboard-charts';
import { reasonLabel } from './jobs';

// shadcn chart configs: each key becomes --color-<key> inside its chart.
const OUTCOMES = { completed: { label: 'Completed', color: 'var(--series-1)' }, failed: { label: 'Failed', color: 'var(--status-critical)' } };
const PROCESSING = { avgProcessingMs: { label: 'Average', color: 'var(--series-1)' }, p95ProcessingMs: { label: 'P95', color: 'var(--series-2)' } };
const QUEUE = { avgQueueMs: { label: 'Average', color: 'var(--series-3)' }, p95QueueMs: { label: 'P95', color: 'var(--series-2)' } };
const byRole = suffix => ({ [`api${suffix}`]: { label: 'API', color: 'var(--series-1)' }, [`worker${suffix}`]: { label: 'Worker', color: 'var(--series-2)' } });
const CPU = byRole('Cpu'), MEMORY = byRole('MemoryMb'), NETWORK = byRole('NetBytes'), RESTARTS = byRole('Restarts');
const API_LATENCY = { requests: { label: 'Requests', color: 'var(--surface-3)' }, averageDurationMs: { label: 'Average', color: 'var(--series-1)' }, p95DurationMs: { label: 'P95', color: 'var(--series-2)' } };
const STATUS_CONFIG = {
  QUEUED: { label: 'Queued', color: 'var(--muted)' }, PROCESSING: { label: 'Processing', color: 'var(--status-warning)' },
  COMPLETED: { label: 'Completed', color: 'var(--series-1)' }, FAILED: { label: 'Failed', color: 'var(--status-critical)' }
};
const FILE_COLORS = { csv: 'var(--series-1)', txt: 'var(--series-3)' };
const STATUS_ORDER = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'];
const nullable = value => (value === '' || value === null || value === undefined ? null : Number(value));
const rateTone = (rate, warn, crit) => (rate >= crit ? 'critical' : rate >= warn ? 'warning' : 'good');


function useDashboard(range) {
  const [data, setData] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); return api(`/api/observability/summary?range=${range}`).then(result => { setData(result); setError(null); }).catch(setError).finally(() => setLoading(false)); };
  useEffect(() => { setData(null); load(); }, [range]);
  return { data, error, loading, load };
}

export function DashboardPage({ search }) {
  const initial = new URLSearchParams(search).get('range');
  const [range, setRangeState] = useState(RANGE_OPTIONS.some(option => option.value === initial) ? initial : '1h');
  const [auto, setAuto] = useState(true);
  const { data, error, loading, load } = useDashboard(range);
  useInterval(load, auto ? 30000 : 0);
  const setRange = value => { setRangeState(value); window.history.replaceState({}, '', `/dashboard?range=${value}`); };
  const fmtX = timeLabel(range), fmtTip = t => `${fmtDay(t)}, ${fmtTime(t)}`;

  const view = useMemo(() => {
    if (!data) return null;
    const s = data.summary, p = data.previous;
    const completed = num(s.completed), failed = num(s.failed), finished = completed + failed;
    const prevFinished = num(p.completed) + num(p.failed);
    const timeline = data.timeline.map(row => {
      const done = num(row.completed) + num(row.failed);
      return { t: splunkTime(row._time), queued: num(row.queued), completed: num(row.completed), failed: num(row.failed), failureRate: done ? (num(row.failed) / done) * 100 : null,
        avgProcessingMs: nullable(row.avgProcessingMs), p95ProcessingMs: nullable(row.p95ProcessingMs), avgQueueMs: nullable(row.avgQueueMs), p95QueueMs: nullable(row.p95QueueMs) };
    });
    const resources = data.resources.timeline.map(row => ({ t: splunkTime(row._time), apiCpu: nullable(row.apiCpu), workerCpu: nullable(row.workerCpu), apiMemoryMb: nullable(row.apiMemoryMb), workerMemoryMb: nullable(row.workerMemoryMb),
      apiRestarts: nullable(row.apiRestarts), workerRestarts: nullable(row.workerRestarts), apiNetBytes: nullable(row.apiNetBytes), workerNetBytes: nullable(row.workerNetBytes) }));
    const apiTimeline = data.apiTimeline.map(row => ({ t: splunkTime(row._time), requests: num(row.requests), averageDurationMs: num(row.requests) ? nullable(row.averageDurationMs) : null, p95DurationMs: num(row.requests) ? nullable(row.p95DurationMs) : null }));
    const statuses = data.statuses.map(row => ({ key: row.job_status, count: num(row.count), fill: `var(--color-${row.job_status})` }))
      .filter(row => STATUS_CONFIG[row.key] && row.count > 0).sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
    const failures = data.failures.map(row => ({ key: row.failure_reason, label: `${reasonLabel(row.failure_reason)} (${row.stage === 'validation' ? 'API' : 'worker'})`, count: num(row.count), fill: 'var(--color-failures)' }));
    const fileTypes = data.fileTypes.map(row => ({ key: row.file_type, count: num(row.count), fill: `var(--color-${row.file_type})` }));
    const fileConfig = Object.fromEntries(fileTypes.map(row => [row.key, { label: `.${row.key}`, color: FILE_COLORS[row.key] || 'var(--status-critical)' }]));
    const restarts = data.containers.reduce((sum, row) => sum + num(row.restarts), 0);
    const down = data.containers.filter(row => row.status !== 'running');
    return { completed, failed, finished, failureRate: finished ? (failed / finished) * 100 : 0, prevFailureRate: prevFinished ? (num(p.failed) / prevFinished) * 100 : null,
      timeline, resources, apiTimeline, containerSource: data.resources.source === 'containers', statuses, failures, fileTypes, fileConfig, restarts, down, statusTotal: statuses.reduce((sum, row) => sum + row.count, 0) };
  }, [data]);

  const health = view && (() => {
    if (view.down.length) return { tone: 'critical', title: 'Container down', text: `${view.down.map(row => row.container_name).join(', ')} is ${view.down[0].status || 'not running'}.` };
    if (!num(data.summary.queued) && !view.finished) return { tone: 'neutral', title: 'No jobs recorded', text: `No files were processed in the ${RANGE_NAMES[range]}.` };
    const issues = [];
    if (view.failureRate >= 25) issues.push(`${fmtPct(view.failureRate)} of finished jobs failed`);
    if (num(data.summary.p95ProcessingMs) > 5000) issues.push(`p95 processing time is ${fmtMs(data.summary.p95ProcessingMs)}`);
    if (view.restarts) issues.push(`${view.restarts} container ${view.restarts === 1 ? 'restart' : 'restarts'} recorded`);
    if (issues.length) return { tone: 'warning', title: 'Needs attention', text: `${issues.join(', ')}.`.replace(/^./, c => c.toUpperCase()) };
    return { tone: 'good', title: 'Processing normally', text: `${fmtInt(view.completed)} jobs completed with p95 of ${fmtMs(data.summary.p95ProcessingMs)}.` };
  })();

  return (
    <>
      <PageHeader spotlight eyebrow="Observability" title="Processing dashboard"
        subtitle={`Jobs, processing time and API/worker container health for the ${RANGE_NAMES[range]}, from Splunk.`}
        actions={<>
          <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <label className="switch"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /><span />Auto 30s</label>
          <button className="btn secondary" onClick={load} disabled={loading}><Icon name="refresh" className={loading ? 'spin' : ''} />{loading ? 'Refreshing' : 'Refresh'}</button>
        </>} />

      {error && !data ? (
        <Card className="error-card">
          <Empty icon="alert" title="Observability data is unavailable">{error.message}{error.code && <span className="error-code">{error.code}</span>}</Empty>
          <div className="center"><button className="btn primary" onClick={load}><Icon name="refresh" />Try again</button></div>
        </Card>
      ) : !data ? (
        <div className="stat-grid">{[0, 1, 2, 3, 4, 5].map(i => <article className="stat" key={i}><Skeleton width="40%" /><Skeleton height={32} width="60%" /><Skeleton height={36} /></article>)}</div>
      ) : (
        <>
          <div className={`banner ${health.tone}`} role="status">
            <i className="status-dot" /><div><b>{health.title}</b><span>{health.text}</span></div>
            <span className="banner-meta">Updated {fmtRelative(data.generatedAt)}{error ? ' · last refresh failed' : ''}</span>
          </div>
          {data.unavailable.length > 0 && <p className="notice warning"><Icon name="alert" />Some panels could not be loaded from Splunk: {data.unavailable.join(', ')}.</p>}

          <div className="stat-grid">
            <Stat label="Jobs created" value={fmtInt(data.summary.queued)} hint={`${fmtInt(data.summary.uploads)} uploads received`}>
              <Delta current={data.summary.queued} previous={data.previous.queued} />
              <Sparkline values={view.timeline.map(row => row.queued)} />
            </Stat>
            <Stat label="Completed" value={fmtInt(view.completed)} tone={view.completed ? 'good' : undefined} hint="Processed by the worker">
              <Delta current={view.completed} previous={data.previous.completed} />
              <Sparkline values={view.timeline.map(row => row.completed)} />
            </Stat>
            <Stat label="Failed" value={fmtInt(view.failed)} tone={rateTone(view.failureRate, 10, 25)} hint={`${fmtPct(view.failureRate)} of finished jobs`}>
              <Delta current={view.failureRate} previous={view.prevFailureRate} invert />
              <Sparkline values={view.timeline.map(row => row.failed)} color="var(--status-critical)" />
            </Stat>
            <Stat label="P95 processing" value={fmtMs(data.summary.p95ProcessingMs)} hint={`Average ${fmtMs(data.summary.avgProcessingMs)}`}>
              <Delta current={data.summary.p95ProcessingMs} previous={data.previous.p95ProcessingMs} invert />
              <Sparkline values={view.timeline.filter(row => row.p95ProcessingMs !== null).map(row => row.p95ProcessingMs)} color="var(--series-2)" />
            </Stat>
            <Stat label="Avg queue time" value={fmtMs(data.summary.avgQueueMs)} hint={`P95 ${fmtMs(data.summary.p95QueueMs)}`}>
              <Sparkline values={view.timeline.filter(row => row.avgQueueMs !== null).map(row => row.avgQueueMs)} color="var(--series-3)" />
            </Stat>
            <Stat label="API requests" value={fmtInt(data.api.requests)} hint={`p95 ${fmtMs(data.api.p95DurationMs)} · ${fmtInt(data.api.serverErrors)} 5xx · ${fmtInt(data.api.clientErrors)} 4xx`}>
              <span className="stat-foot">Container restarts: <b className={view.restarts ? 'text-critical' : ''}>{fmtInt(view.restarts)}</b></span>
            </Stat>
          </div>

          <div className="dash-grid">
            <Card className="span-2" title="Jobs over time" subtitle="Finished jobs per interval by outcome">
              {!view.finished ? <Empty title="No finished jobs in this window">Upload a file or run a demo scenario.</Empty>
                : <StackedBarChart data={view.timeline} config={OUTCOMES} xFormat={fmtX} timeFormat={fmtTip} valueFormat={value => `${fmtInt(value)} jobs`} />}
            </Card>
            <Card title="Job status" subtitle="Where every job in this window ended up">
              {!view.statuses.length ? <Empty title="No jobs yet" /> : <DonutChart rows={view.statuses} config={STATUS_CONFIG} centerLabel="jobs" valueFormat={value => `${fmtInt(value)} jobs`} />}
            </Card>

            <Card className="span-2" title="Processing duration" subtitle="Average and P95 time the worker spent on completed jobs">
              {!view.timeline.some(row => row.avgProcessingMs !== null) ? <Empty title="No completed jobs yet" />
                : <TimeSeriesChart data={view.timeline} config={PROCESSING} xFormat={fmtX} timeFormat={fmtTip} yFormat={fmtAxisMs} valueFormat={fmtMs} />}
            </Card>
            <Card className="fill" title="Failure reasons" subtitle="Most common causes, API and worker">
              {!view.failures.length ? <Empty icon="check" title="No failures in this window" />
                : <RankingBarChart rows={view.failures} config={{ failures: { label: 'Failures', color: 'var(--status-critical)' } }} valueFormat={value => fmtInt(value)} />}
            </Card>

            <Card className="span-2" title="Queue time" subtitle="Average and P95 wait between upload and the worker starting the job">
              {!view.timeline.some(row => row.avgQueueMs !== null) ? <Empty title="No queue data yet" />
                : <TimeSeriesChart data={view.timeline} config={QUEUE} xFormat={fmtX} timeFormat={fmtTip} yFormat={fmtAxisMs} valueFormat={fmtMs} />}
            </Card>
            <Card title="File types" subtitle="Uploads by extension">
              {!view.fileTypes.length ? <Empty icon="file" title="No uploads yet" /> : <DonutChart rows={view.fileTypes} config={view.fileConfig} centerLabel="uploads" valueFormat={value => `${fmtInt(value)} uploads`} />}
            </Card>

            <Card title="CPU usage" subtitle={view.containerSource ? 'Docker container CPU % (100% = one core)' : 'Node.js process CPU %'}>
              {!view.resources.some(row => row.apiCpu !== null || row.workerCpu !== null) ? <Empty icon="server" title="No CPU samples yet">The metrics agent reports every 10 seconds.</Empty>
                : <TimeSeriesChart kind="line" data={view.resources} config={CPU} height={220} connectNulls xFormat={fmtX} timeFormat={fmtTip} yFormat={value => `${Number(value).toFixed(value < 10 ? 1 : 0)}%`} valueFormat={value => fmtPct(value, 2)} />}
            </Card>
            <Card title="Memory" subtitle={view.containerSource ? 'Container memory, MB' : 'Process resident memory, MB'}>
              {!view.resources.some(row => row.apiMemoryMb !== null || row.workerMemoryMb !== null) ? <Empty icon="server" title="No memory samples yet" />
                : <TimeSeriesChart data={view.resources} config={MEMORY} height={220} connectNulls xFormat={fmtX} timeFormat={fmtTip} yFormat={value => `${Math.round(value)}`} valueFormat={value => `${Number(value).toFixed(1)} MB`} />}
            </Card>
            <Card title="Network throughput" subtitle="Received + sent per container">
              {!view.containerSource ? <Empty icon="server" title="No container metrics">Network stats come from the Docker metrics agent.</Empty>
                : <TimeSeriesChart data={view.resources} config={NETWORK} stacked height={220} connectNulls xFormat={fmtX} timeFormat={fmtTip} yFormat={value => fmtBytes(value).replace('/s', '')} valueFormat={fmtBytes} />}
            </Card>

            <Card className="span-2" title="Containers" subtitle="Latest Docker runtime state from the metrics agent">
              {!data.containers.length ? <Empty icon="server" title="No container metrics">Run the stack with Docker Compose so the metrics agent can report the API and worker containers.</Empty> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Container</th><th>State</th><th className="num">CPU</th><th className="num">Memory</th><th className="num">Net in</th><th className="num">Net out</th><th className="num">Restarts</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {data.containers.map(row => (
                        <tr key={row.container_name}>
                          <td><code className="path">{row.container_name}</code></td>
                          <td><span className={`pill ${row.status === 'running' ? 'good' : 'critical'}`}><i />{row.status || 'unknown'}</span></td>
                          <td className="num">{row.cpuPercent !== undefined ? fmtPct(row.cpuPercent) : '—'}</td>
                          <td className="num">{num(row.memoryUsageMb).toFixed(0)} MB <em className="muted">· {fmtPct(row.memoryPercent)}</em></td>
                          <td className="num">{row.rxBytesPerSecond !== undefined ? fmtBytes(row.rxBytesPerSecond) : '—'}</td>
                          <td className="num">{row.txBytesPerSecond !== undefined ? fmtBytes(row.txBytesPerSecond) : '—'}</td>
                          <td className={`num ${num(row.restarts) > 0 ? 'text-critical' : ''}`}>{fmtInt(row.restarts)}</td>
                          <td>{row.lastSeen ? fmtRelative(row.lastSeen) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Restart count over time" subtitle="Docker RestartCount per container">
              {!view.containerSource ? <Empty icon="server" title="No container metrics" />
                : <TimeSeriesChart kind="step" data={view.resources} config={RESTARTS} height={220} connectNulls xFormat={fmtX} timeFormat={fmtTip} valueFormat={value => `${fmtInt(value)} restarts`} />}
            </Card>

            <Card className="span-3" title="API response time" subtitle="Requests per interval with average and P95 latency · excludes the Splunk-backed /api/observability calls">
              {!view.apiTimeline.some(row => row.requests) ? <Empty title="No API requests in this window" />
                : <LatencyVolumeChart data={view.apiTimeline} config={API_LATENCY} xFormat={fmtX} timeFormat={fmtTip} msFormat={fmtMs} axisMsFormat={fmtAxisMs} countFormat={value => fmtInt(value)} />}
            </Card>

            <Card className="span-2 hug" title="Recent job failures" subtitle="Newest first, from the API and the worker">
              {!data.recentFailures.length ? <Empty icon="check" title="No failures in this window" /> : (
                <div className="table-wrap scroll">
                  <table>
                    <thead><tr><th>Time</th><th>Job</th><th>File</th><th>Stage</th><th>Reason</th></tr></thead>
                    <tbody>
                      {data.recentFailures.map(row => (
                        <tr key={`${row.job_id}-${row.timestamp}`}>
                          <td className="mono" title={row.timestamp ? fmtDate(row.timestamp) : ''}>{row.timestamp ? fmtTime(row.timestamp, true) : '—'}</td>
                          <td><a className="path-link" {...linkProps(`/jobs/${row.job_id}`)}><code>{row.job_id}</code></a></td>
                          <td><span className="cell-truncate" title={row.file_name}>{row.file_name}</span></td>
                          <td>{row.failure_stage === 'validation' ? 'API' : 'Worker'}</td>
                          <td><code className="err-code">{row.failure_reason}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="hug" title="Slowest jobs" subtitle="Longest processing, with time spent queued">
              {!data.slowest.length ? <Empty title="No completed jobs yet" /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Job</th><th className="num">Queued</th><th className="num">Processing</th></tr></thead>
                    <tbody>
                      {data.slowest.map(row => (
                        <tr key={`${row.job_id}-${row.timestamp}`}>
                          <td><a className="path-link" {...linkProps(`/jobs/${row.job_id}`)}><code>{row.job_id}</code></a><span className="cell-sub cell-truncate" title={row.file_name}>{row.file_name}</span></td>
                          <td className="num">{fmtMs(row.queue_time_ms)}</td>
                          <td className={`num ${num(row.processing_duration_ms) > 5000 ? 'text-critical' : ''}`}>{fmtMs(row.processing_duration_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          <p className="footnote">Generated {fmtDate(data.generatedAt)} from Splunk indexes <code>container_logs</code> and <code>container_metrics</code>.</p>
        </>
      )}
    </>
  );
}
