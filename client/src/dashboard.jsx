import React, { useEffect, useMemo, useState } from 'react';
import { api, num, fmtInt, fmtMs, fmtAxisMs, fmtPct, fmtBytes, fmtRelative, fmtDate, timeLabel, RANGE_OPTIONS, RANGE_NAMES, useInterval, linkProps } from './lib';
import { Card, PageHeader, Segmented, Stat, Delta, Empty, Skeleton, Icon } from './ui';
import { LineChart, ColumnChart, Sparkline, Legend, ShareBar } from './charts';
import { StatusPill, reasonLabel } from './jobs';

const OUTCOMES = [
  { key: 'completed', label: 'Completed', color: 'var(--series-1)' },
  { key: 'failed', label: 'Failed', color: 'var(--status-critical)' }
];
const DURATION = [
  { key: 'avgProcessingMs', label: 'Avg processing', color: 'var(--series-1)', shape: 'line' },
  { key: 'p95ProcessingMs', label: 'P95 processing', color: 'var(--series-2)', shape: 'line' },
  { key: 'avgQueueMs', label: 'Avg queue time', color: 'var(--series-3)', shape: 'line' }
];
const CPU = [
  { key: 'apiCpu', label: 'API', color: 'var(--series-1)', shape: 'line' },
  { key: 'workerCpu', label: 'Worker', color: 'var(--series-2)', shape: 'line' }
];
const MEMORY = [
  { key: 'apiMemoryMb', label: 'API', color: 'var(--series-1)', shape: 'line' },
  { key: 'workerMemoryMb', label: 'Worker', color: 'var(--series-2)', shape: 'line' }
];
const STATUS_COLOR = { COMPLETED: 'var(--series-1)', FAILED: 'var(--status-critical)', PROCESSING: 'var(--status-warning)', QUEUED: 'var(--muted)' };
const STATUS_ORDER = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'];
const nullable = value => (value === '' || value === null || value === undefined ? null : Number(value));
const rateTone = (rate, warn, crit) => (rate >= crit ? 'critical' : rate >= warn ? 'warning' : 'good');

function BarList({ rows, total, label, color }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return (
    <ul className="bar-list">
      {rows.map(row => (
        <li key={row.key}>
          <div className="bar-list-head">{label(row)}<span className="bar-list-value">{fmtInt(row.count)} <em>{total ? fmtPct((row.count / total) * 100) : ''}</em></span></div>
          <ShareBar value={row.count} max={max} color={color(row)} />
        </li>
      ))}
    </ul>
  );
}

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
  const fmtX = timeLabel(range);

  const view = useMemo(() => {
    if (!data) return null;
    const s = data.summary, p = data.previous;
    const completed = num(s.completed), failed = num(s.failed), finished = completed + failed;
    const prevFinished = num(p.completed) + num(p.failed);
    const timeline = data.timeline.map(row => {
      const done = num(row.completed) + num(row.failed);
      return { time: row._time, queued: num(row.queued), completed: num(row.completed), failed: num(row.failed), failureRate: done ? (num(row.failed) / done) * 100 : null,
        avgProcessingMs: nullable(row.avgProcessingMs), p95ProcessingMs: nullable(row.p95ProcessingMs), avgQueueMs: nullable(row.avgQueueMs) };
    });
    const resources = data.resources.timeline.map(row => ({ time: row._time, apiCpu: nullable(row.apiCpu), workerCpu: nullable(row.workerCpu), apiMemoryMb: nullable(row.apiMemoryMb), workerMemoryMb: nullable(row.workerMemoryMb) }));
    const statuses = data.statuses.map(row => ({ key: row.job_status, count: num(row.count) })).sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
    const failures = data.failures.map(row => ({ key: row.failure_reason, stage: row.stage, count: num(row.count) }));
    const fileTypes = data.fileTypes.map(row => ({ key: row.file_type, count: num(row.count) }));
    const restarts = data.containers.reduce((sum, row) => sum + num(row.restarts), 0);
    const down = data.containers.filter(row => row.status !== 'running');
    return { completed, failed, finished, failureRate: finished ? (failed / finished) * 100 : 0, prevFailureRate: prevFinished ? (num(p.failed) / prevFinished) * 100 : null,
      timeline, resources, statuses, failures, fileTypes, restarts, down, statusTotal: statuses.reduce((sum, row) => sum + row.count, 0) };
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
                : <><Legend series={OUTCOMES} /><ColumnChart data={view.timeline} series={OUTCOMES} xFormat={fmtX} yFormat={fmtInt} label="Jobs completed and failed over time" /></>}
            </Card>
            <Card title="Job status" subtitle="Latest status of each job">
              {!view.statuses.length ? <Empty title="No jobs yet" /> : <BarList rows={view.statuses} total={view.statusTotal} label={row => <StatusPill status={row.key} />} color={row => STATUS_COLOR[row.key] || 'var(--muted)'} />}
            </Card>

            <Card className="span-2" title="Processing and queue time" subtitle="Average and P95 processing duration, average wait in the queue">
              {!view.timeline.some(row => row.avgProcessingMs !== null || row.avgQueueMs !== null) ? <Empty title="No timing data yet" />
                : <><Legend series={DURATION} /><LineChart data={view.timeline} series={DURATION} xFormat={fmtX} yFormat={fmtAxisMs} valueFormat={fmtMs} label="Processing and queue time" area={false} thresholds={[{ value: 5000, label: 'Slow · 5 s' }]} /></>}
            </Card>
            <Card title="Failure reasons" subtitle="Most common causes, API and worker">
              {!view.failures.length ? <Empty icon="check" title="No failures in this window" />
                : <BarList rows={view.failures} total={view.failed} label={row => <span className="reason">{reasonLabel(row.key)}<em>{row.stage === 'validation' ? 'API' : 'worker'}</em></span>} color={() => 'var(--status-critical)'} />}
            </Card>

            <Card title="CPU usage" subtitle={view && data.resources.source === 'containers' ? 'Docker container CPU %' : 'Node.js process CPU %'}>
              {!view.resources.length ? <Empty icon="server" title="No resource metrics">Start the metrics agent or set <code>SPLUNK_METRICS_HEC_TOKEN</code>.</Empty>
                : <><Legend series={CPU} /><LineChart data={view.resources} series={CPU} height={180} area={false} xFormat={fmtX} yFormat={value => `${Number(value).toFixed(value < 10 ? 1 : 0)}%`} valueFormat={value => fmtPct(value, 2)} label="API and worker CPU" /></>}
            </Card>
            <Card title="Memory" subtitle={data.resources.source === 'containers' ? 'Container memory, MB' : 'Process resident memory, MB'}>
              {!view.resources.length ? <Empty icon="server" title="No resource metrics" />
                : <><Legend series={MEMORY} /><LineChart data={view.resources} series={MEMORY} height={180} area={false} xFormat={fmtX} yFormat={value => `${Math.round(value)}`} valueFormat={value => `${Number(value).toFixed(1)} MB`} label="API and worker memory" /></>}
            </Card>
            <Card title="File types" subtitle="Uploads by extension">
              {!view.fileTypes.length ? <Empty icon="file" title="No uploads yet" />
                : <BarList rows={view.fileTypes} total={view.fileTypes.reduce((sum, row) => sum + row.count, 0)} label={row => <code className={['csv', 'txt'].includes(row.key) ? '' : 'text-critical'}>.{row.key}</code>} color={row => (['csv', 'txt'].includes(row.key) ? 'var(--series-1)' : 'var(--status-critical)')} />}
            </Card>

            <Card className="span-2" title="Containers" subtitle="Docker runtime state from the metrics agent">
              {!data.containers.length ? <Empty icon="server" title="No container metrics">Run the stack with Docker Compose so the metrics agent can report the API and worker containers.</Empty> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Container</th><th>State</th><th className="num">CPU</th><th className="num">Memory</th><th className="num">Net in</th><th className="num">Net out</th><th className="num">Restarts</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {data.containers.map(row => (
                        <tr key={row.container_name}>
                          <td><code className="path">{row.container_name}</code></td>
                          <td><span className={`pill ${row.status === 'running' ? 'good' : 'critical'}`}><i />{row.status || 'unknown'}</span></td>
                          <td className="num">{fmtPct(row.cpuPercent)}</td>
                          <td className="num">{num(row.memoryUsageMb).toFixed(0)} MB <em className="muted">· {fmtPct(row.memoryPercent)}</em></td>
                          <td className="num">{fmtBytes(row.rxBytesPerSecond)}</td>
                          <td className="num">{fmtBytes(row.txBytesPerSecond)}</td>
                          <td className={`num ${num(row.restarts) > 0 ? 'text-critical' : ''}`}>{fmtInt(row.restarts)}</td>
                          <td>{row.lastSeen ? fmtRelative(row.lastSeen) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Slowest jobs" subtitle="Select one to open it">
              {!data.slowest.length ? <Empty title="No completed jobs yet" /> : (
                <ul className="slow-list">
                  {data.slowest.map(row => (
                    <li key={row.job_id}>
                      <a {...linkProps(`/jobs/${row.job_id}`)}>
                        <div title={row.timestamp ? fmtDate(row.timestamp) : ''}><span className="method">{(row.file_type || '').toUpperCase()}</span><code className="path">{row.job_id} · {row.file_name}</code></div>
                        <div className="slow-meta"><b className={num(row.processing_duration_ms) > 5000 ? 'text-critical' : ''}>{fmtMs(row.processing_duration_ms)}</b></div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <p className="footnote">Generated {fmtDate(data.generatedAt)} from Splunk indexes <code>container_logs</code> and <code>container_metrics</code>.</p>
        </>
      )}
    </>
  );
}
