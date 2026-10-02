import React, { useEffect, useMemo, useState } from 'react';
import { api, num, fmtInt, fmtMs, fmtAxisMs, fmtPct, fmtDuration, fmtBytes, fmtRelative, fmtDate, timeLabel, RANGE_OPTIONS, RANGE_NAMES, useInterval, linkProps, navigate } from './lib';
import { Card, PageHeader, Segmented, Stat, Delta, Empty, Skeleton, Icon, StatusBadge, MethodTag } from './ui';
import { LineChart, ColumnChart, Sparkline, Legend, ShareBar } from './charts';

const TRAFFIC = [
  { key: 'ok', label: 'Successful', color: 'var(--series-1)' },
  { key: 'clientErrors', label: '4xx client errors', color: 'var(--status-warning)' },
  { key: 'serverErrors', label: '5xx server errors', color: 'var(--status-critical)' }
];
const LATENCY = [
  { key: 'averageDurationMs', label: 'Average', color: 'var(--series-1)', shape: 'line' },
  { key: 'p95DurationMs', label: 'P95', color: 'var(--series-2)', shape: 'line' }
];
const MEMORY = [
  { key: 'memoryRssMb', label: 'Resident (RSS)', color: 'var(--series-1)', shape: 'line' },
  { key: 'heapUsedMb', label: 'Heap used', color: 'var(--series-3)', shape: 'line' }
];
const CPU = [{ key: 'cpuPercent', label: 'CPU', color: 'var(--series-1)', shape: 'line' }];
const nullable = value => (value === '' || value === null || value === undefined ? null : Number(value));
const statusColor = code => (code >= 500 ? 'var(--status-critical)' : code >= 400 ? 'var(--status-warning)' : code >= 300 ? 'var(--muted)' : 'var(--series-1)');
const rateTone = (rate, warn, crit) => (rate >= crit ? 'critical' : rate >= warn ? 'warning' : 'good');

function ChartToggle({ table, setTable }) {
  return <button type="button" className="btn ghost sm" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>;
}
function DataTable({ columns, rows }) {
  return (
    <div className="table-wrap compact">
      <table>
        <thead><tr>{columns.map(column => <th key={column.key} className={column.numeric ? 'num' : ''}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key} className={column.numeric ? 'num' : ''}>{column.format ? column.format(row[column.key]) : row[column.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
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
  const [range, setRangeState] = useState(RANGE_OPTIONS.some(option => option.value === initial) ? initial : '24h');
  const [auto, setAuto] = useState(false), [trafficTable, setTrafficTable] = useState(false), [latencyTable, setLatencyTable] = useState(false), [latencyScale, setLatencyScale] = useState(null);
  const { data, error, loading, load } = useDashboard(range);
  useInterval(load, auto ? 30000 : 0);
  const setRange = value => { setRangeState(value); window.history.replaceState({}, '', `/dashboard?range=${value}`); };
  const fmtX = timeLabel(range);

  const view = useMemo(() => {
    if (!data) return null;
    const s = data.summary, p = data.previous;
    const requests = num(s.requests), client = num(s.clientErrors), server = num(s.serverErrors);
    const errorRate = requests ? ((client + server) / requests) * 100 : 0, availability = requests ? (1 - server / requests) * 100 : 100;
    const prevRequests = num(p.requests), prevErrorRate = prevRequests ? (num(p.errors) / prevRequests) * 100 : null;
    const timeline = data.timeline.map(row => {
      const total = num(row.requests), c = num(row.clientErrors), e = num(row.serverErrors);
      return { time: row._time, requests: total, ok: Math.max(0, total - c - e), clientErrors: c, serverErrors: e, errorRate: total ? ((c + e) / total) * 100 : null,
        averageDurationMs: total ? nullable(row.averageDurationMs) : null, p95DurationMs: total ? nullable(row.p95DurationMs) : null };
    });
    const metrics = data.metricsTimeline.map(row => ({ time: row._time, cpuPercent: nullable(row.cpuPercent), memoryRssMb: nullable(row.memoryRssMb), heapUsedMb: nullable(row.heapUsedMb) }));
    const statuses = data.statuses.map(row => ({ status: Number(row.status), count: num(row.count) })).sort((a, b) => a.status - b.status);
    const minutes = { '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 }[data.range];
    // Latency headline: busiest-interval peak, and whether outliers would flatten a linear axis.
    const latencyPoints = timeline.filter(row => row.p95DurationMs !== null);
    const peak = latencyPoints.reduce((best, row) => (!best || row.p95DurationMs > best.p95DurationMs ? row : best), null);
    const sortedAvg = latencyPoints.map(row => row.averageDurationMs).filter(value => value !== null).sort((a, b) => a - b);
    const typical = sortedAvg.length ? sortedAvg[Math.floor(sortedAvg.length / 2)] : 0;
    const latency = { peak, typical, intervals: latencyPoints.length, skewed: peak && typical > 0 && peak.p95DurationMs / typical > 15 };
    return { requests, client, server, errorRate, availability, prevRequests, prevErrorRate, timeline, metrics, statuses, latency, perMinute: requests / minutes };
  }, [data]);

  // 4xx responses are mostly validation and duplicate-registration outcomes, so health is driven by 5xx and latency.
  const health = view && (() => {
    const p95 = num(data.summary.p95DurationMs), clientRate = view.requests ? (view.client / view.requests) * 100 : 0;
    if (view.requests === 0) return { tone: 'neutral', title: 'No traffic recorded', text: `No requests reached the API in the ${RANGE_NAMES[range]}.` };
    if (view.availability < 99) return { tone: 'critical', title: 'Service degraded', text: `${fmtPct(100 - view.availability, 2)} of requests failed with a server error.` };
    const issues = [];
    if (view.availability < 99.9) issues.push(`${fmtInt(view.server)} server ${view.server === 1 ? 'error' : 'errors'} (${fmtPct(100 - view.availability, 2)})`);
    if (p95 > 1000) issues.push(`slow p95 of ${fmtMs(p95)}`);
    if (clientRate >= 25) issues.push(`${fmtPct(clientRate)} of requests rejected as client errors`);
    if (issues.length) return { tone: 'warning', title: 'Needs attention', text: `${issues.join(', ')}.`.replace(/^./, c => c.toUpperCase()) };
    return { tone: 'good', title: 'Operating normally', text: `${fmtPct(view.availability, 2)} availability with p95 of ${fmtMs(p95)}.` };
  })();

  return (
    <>
      <PageHeader spotlight eyebrow="Observability" title="Service dashboard"
        subtitle={`Request traffic, latency and runtime health for the ${RANGE_NAMES[range]}.`}
        actions={<>
          <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <label className="switch"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /><span />Auto 30s</label>
          <button className="btn secondary" onClick={load} disabled={loading}><Icon name="refresh" className={loading ? 'spin' : ''} />{loading ? 'Refreshing' : 'Refresh'}</button>
        </>} />

      {error && !data ? (
        <Card className="error-card">
          <Empty icon="alert" title="Observability data is unavailable">
            {error.code === 'ROUTE_NOT_FOUND' ? 'The running API server is older than this page. Restart it (cd server && npm start) so the observability endpoints are available.' : error.message}
            {error.code && <span className="error-code">{error.code}</span>}
          </Empty>
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
            <Stat label="Requests" value={fmtInt(view.requests)} hint={`${view.perMinute.toFixed(view.perMinute < 10 ? 2 : 0)} per minute`}>
              <Delta current={view.requests} previous={view.prevRequests} />
              <Sparkline values={view.timeline.map(row => row.requests)} />
            </Stat>
            <Stat label="Error rate" value={fmtPct(view.errorRate, 2)} tone={rateTone(view.errorRate, 5, 25)} hint={`${fmtInt(view.client)} client · ${fmtInt(view.server)} server`}>
              <Delta current={view.errorRate} previous={view.prevErrorRate} invert />
              <Sparkline values={view.timeline.filter(row => row.errorRate !== null).map(row => row.errorRate)} color="var(--status-critical)" />
            </Stat>
            <Stat label="P95 latency" value={fmtMs(data.summary.p95DurationMs)} tone={rateTone(num(data.summary.p95DurationMs), 500, 1000)} hint={`p50 ${fmtMs(data.summary.p50DurationMs)} · p99 ${fmtMs(data.summary.p99DurationMs)}`}>
              <Delta current={data.summary.p95DurationMs} previous={data.previous.p95DurationMs} invert />
              <Sparkline values={view.timeline.filter(row => row.p95DurationMs !== null).map(row => row.p95DurationMs)} color="var(--series-2)" />
            </Stat>
            <Stat label="Availability" value={fmtPct(view.availability, 2)} tone={view.availability >= 99.9 ? 'good' : view.availability >= 99 ? 'warning' : 'critical'} hint="Requests without a 5xx response">
              <span className="stat-foot">{fmtInt(view.server)} server {view.server === 1 ? 'error' : 'errors'}</span>
            </Stat>
            <Stat label="Slow requests" value={fmtInt(data.summary.slowRequests)} hint="Took longer than 1 second">
              <span className="stat-foot">{view.requests ? fmtPct((num(data.summary.slowRequests) / view.requests) * 100, 2) : '0%'} of traffic · max {fmtMs(data.summary.maxDurationMs)}</span>
            </Stat>
            <Stat label="Process CPU" value={data.metrics.cpuPercent !== undefined ? fmtPct(data.metrics.cpuPercent) : '—'} hint={data.metrics.memoryRssMb !== undefined ? `${num(data.metrics.memoryRssMb).toFixed(0)} MB memory · up ${fmtDuration(data.metrics.uptimeSeconds)}` : 'No runtime metrics yet'}>
              <Sparkline values={view.metrics.filter(row => row.cpuPercent !== null).map(row => row.cpuPercent)} />
            </Stat>
          </div>

          <div className="dash-grid">
            <Card className="span-2" title="Traffic" subtitle="Requests per interval, split by outcome" actions={<ChartToggle table={trafficTable} setTable={setTrafficTable} />}>
              {!view.requests ? <Empty title="No requests in this window">Traffic appears here as soon as the API is used.</Empty> : trafficTable ? (
                <DataTable rows={view.timeline.filter(row => row.requests)} columns={[{ key: 'time', label: 'Time', format: fmtX }, { key: 'requests', label: 'Total', numeric: true }, { key: 'ok', label: 'Successful', numeric: true }, { key: 'clientErrors', label: '4xx', numeric: true }, { key: 'serverErrors', label: '5xx', numeric: true }]} />
              ) : (<><Legend series={TRAFFIC} /><ColumnChart data={view.timeline} series={TRAFFIC} xFormat={fmtX} yFormat={fmtInt} label="Requests over time by outcome" /></>)}
            </Card>

            <Card title="Status codes" subtitle={`${view.statuses.length} distinct responses`}>
              {!view.statuses.length ? <Empty title="No responses yet" /> : (
                <ul className="bar-list">
                  {view.statuses.map(row => (
                    <li key={row.status}>
                      <div className="bar-list-head"><StatusBadge status={row.status} /><span className="bar-list-value">{fmtInt(row.count)} <em>{fmtPct((row.count / view.requests) * 100)}</em></span></div>
                      <ShareBar value={row.count} max={Math.max(...view.statuses.map(item => item.count))} color={statusColor(row.status)} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="span-2" title="Response time" subtitle="Average and 95th percentile per interval"
              actions={<>
                {!latencyTable && view.requests > 0 && <Segmented label="Y axis scale" options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }]} value={latencyScale || (view.latency.skewed ? 'log' : 'linear')} onChange={setLatencyScale} />}
                <ChartToggle table={latencyTable} setTable={setLatencyTable} />
              </>}>
              {!view.requests ? <Empty title="No latency data" /> : latencyTable ? (
                <DataTable rows={view.timeline.filter(row => row.requests)} columns={[{ key: 'time', label: 'Time', format: fmtX }, { key: 'requests', label: 'Requests', numeric: true }, { key: 'averageDurationMs', label: 'Average', numeric: true, format: fmtMs }, { key: 'p95DurationMs', label: 'P95', numeric: true, format: fmtMs }]} />
              ) : (<>
                <dl className="chart-stats">
                  <div><dt>Average</dt><dd>{fmtMs(data.summary.averageDurationMs)}</dd></div>
                  <div><dt>P50</dt><dd>{fmtMs(data.summary.p50DurationMs)}</dd></div>
                  <div><dt>P95</dt><dd>{fmtMs(data.summary.p95DurationMs)}</dd></div>
                  <div><dt>P99</dt><dd>{fmtMs(data.summary.p99DurationMs)}</dd></div>
                  {view.latency.peak && <div><dt>Worst interval</dt><dd className={view.latency.peak.p95DurationMs > 1000 ? 'text-critical' : ''}>{fmtMs(view.latency.peak.p95DurationMs)} <em>at {fmtX(view.latency.peak.time)}</em></dd></div>}
                </dl>
                <Legend series={LATENCY} />
                <LineChart data={view.timeline} series={LATENCY} xFormat={fmtX} yFormat={fmtAxisMs} valueFormat={fmtMs} label="Average and p95 response time"
                  scale={latencyScale || (view.latency.skewed ? 'log' : 'linear')} thresholds={[{ value: 1000, label: 'Slow · 1 s' }]} />
                {view.latency.intervals < view.timeline.length * 0.5 && <p className="chart-note">Traffic was recorded in {view.latency.intervals} of {view.timeline.length} intervals; gaps mean no requests.</p>}
              </>)}
            </Card>

            <Card title="Slowest requests" subtitle="Select one to inspect its logs">
              {!data.slowest.length ? <Empty title="Nothing slow to report" /> : (
                <ul className="slow-list">
                  {data.slowest.map(row => (
                    <li key={row.request_id || row.timestamp}>
                      <a {...linkProps(`/logs?range=${range}&q=${encodeURIComponent(row.request_id || '')}`)}>
                        <div title={row.timestamp ? fmtDate(row.timestamp) : ''}><MethodTag method={row.method} /><code className="path">{row.path}</code></div>
                        <div className="slow-meta"><StatusBadge status={row.status} /><b className={num(row.duration_ms) > 1000 ? 'text-critical' : ''}>{fmtMs(row.duration_ms)}</b></div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="span-3" title="Endpoints" subtitle="Busiest routes with error rate and latency">
              {!data.routes.length ? <Empty title="No routes recorded" /> : (
                <div className="table-wrap">
                  <table className="routes">
                    <thead><tr><th>Endpoint</th><th className="num">Requests</th><th className="share-col" aria-label="Share of traffic" /><th className="num">Errors</th><th className="num">Error rate</th><th className="num">Avg</th><th className="num">P95</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                      {data.routes.map(route => {
                        const total = num(route.requests), rate = total ? (num(route.errors) / total) * 100 : 0, maxRequests = Math.max(...data.routes.map(item => num(item.requests)));
                        return (
                          <tr key={`${route.method} ${route.path}`}>
                            <td><div className="endpoint"><MethodTag method={route.method} /><code className="path">{route.path}</code></div></td>
                            <td className="num">{fmtInt(total)}</td>
                            <td className="share-col"><ShareBar value={total} max={maxRequests} /></td>
                            <td className="num">{fmtInt(route.errors)}</td>
                            <td className="num"><span className={`rate ${rateTone(rate, 2, 10)}`}>{fmtPct(rate)}</span></td>
                            <td className="num">{fmtMs(route.averageDurationMs)}</td>
                            <td className={`num ${num(route.p95DurationMs) > 1000 ? 'text-critical' : ''}`}>{fmtMs(route.p95DurationMs)}</td>
                            <td><button className="btn ghost sm" onClick={() => navigate(`/logs?range=${range}&path=${encodeURIComponent(route.path)}`)}>Logs<Icon name="chevron" size={14} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="CPU usage" subtitle="Node.js process, % of one core">
              {!view.metrics.length ? <Empty icon="server" title="No runtime metrics">Set <code>SPLUNK_METRICS_HEC_TOKEN</code> to stream process stats.</Empty>
                : <LineChart data={view.metrics} series={CPU} height={190} xFormat={fmtX} yFormat={value => `${Number(value).toFixed(value < 10 ? 1 : 0)}%`} valueFormat={value => fmtPct(value, 2)} label="CPU usage over time" />}
            </Card>
            <Card title="Memory" subtitle="Resident set and V8 heap, MB">
              {!view.metrics.length ? <Empty icon="server" title="No runtime metrics" />
                : <><Legend series={MEMORY} /><LineChart data={view.metrics} series={MEMORY} height={168} area={false} xFormat={fmtX} yFormat={value => `${Math.round(value)}`} valueFormat={value => `${Number(value).toFixed(1)} MB`} label="Memory usage over time" /></>}
            </Card>
            <Card title="Runtime" subtitle="Latest process snapshot">
              <dl className="facts-list">
                <div><dt>Uptime</dt><dd>{data.metrics.uptimeSeconds !== undefined ? fmtDuration(data.metrics.uptimeSeconds) : '—'}</dd></div>
                <div><dt>Memory (RSS)</dt><dd>{data.metrics.memoryRssMb !== undefined ? `${num(data.metrics.memoryRssMb).toFixed(1)} MB` : '—'}</dd></div>
                <div><dt>Heap used</dt><dd>{data.metrics.heapUsedMb !== undefined ? `${num(data.metrics.heapUsedMb).toFixed(1)} MB` : '—'}</dd></div>
                <div><dt>Peak CPU</dt><dd>{data.metrics.peakCpuPercent !== undefined ? fmtPct(data.metrics.peakCpuPercent) : '—'}</dd></div>
                <div><dt>Peak memory</dt><dd>{data.metrics.peakMemoryRssMb !== undefined ? `${num(data.metrics.peakMemoryRssMb).toFixed(1)} MB` : '—'}</dd></div>
                <div><dt>Routes seen</dt><dd>{fmtInt(data.summary.uniqueRoutes)}</dd></div>
              </dl>
            </Card>

            {data.containers.length > 0 && (
              <Card className="span-3" title="Containers" subtitle="Docker runtime stats from the metrics agent">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Container</th><th>State</th><th className="num">CPU</th><th className="num">Memory</th><th className="num">Net in</th><th className="num">Net out</th><th className="num">Restarts</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {data.containers.map(row => (
                        <tr key={row.container_name}>
                          <td><code className="path">{row.container_name}</code></td>
                          <td><span className={`pill ${row.status === 'running' ? 'good' : 'critical'}`}><i />{row.status || 'unknown'}</span></td>
                          <td className="num">{fmtPct(row.cpuPercent)}</td>
                          <td className="num">{fmtPct(row.memoryPercent)} <em className="muted">· {num(row.memoryUsageMb).toFixed(0)} MB</em></td>
                          <td className="num">{fmtBytes(row.rxBytesPerSecond)}</td>
                          <td className="num">{fmtBytes(row.txBytesPerSecond)}</td>
                          <td className={`num ${num(row.restarts) > 0 ? 'text-critical' : ''}`}>{fmtInt(row.restarts)}</td>
                          <td>{row.lastSeen ? fmtRelative(row.lastSeen) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
          <p className="footnote">Generated {fmtDate(data.generatedAt)} from Splunk indexes <code>container_logs</code> and <code>container_metrics</code>.</p>
        </>
      )}
    </>
  );
}
