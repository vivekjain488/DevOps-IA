import React, { useEffect, useMemo, useState } from 'react';
import { api, num, fmtInt, fmtMs, fmtTime, fmtDay, fmtRelative, timeLabel, RANGE_OPTIONS, RANGE_NAMES, useInterval, download } from './lib';
import { Card, PageHeader, Segmented, Empty, Skeleton, Icon, StatusBadge, LevelBadge, MethodTag } from './ui';
import { ColumnChart, Legend } from './charts';

const SAFE = /^[\w\s\-./:@]*$/;
const LEVEL_SERIES = {
  debug: { label: 'Debug', color: 'var(--muted)' },
  info: { label: 'Info', color: 'var(--series-1)' },
  warn: { label: 'Warn', color: 'var(--status-warning)' },
  error: { label: 'Error', color: 'var(--status-critical)' },
  fatal: { label: 'Fatal', color: 'var(--status-critical-strong)' }
};
const LEVEL_ORDER = ['debug', 'info', 'warn', 'error', 'fatal'];
const STATUS_OPTIONS = [{ value: '', label: 'Any status' }, { value: '2xx', label: '2xx success' }, { value: '3xx', label: '3xx redirect' }, { value: '4xx', label: '4xx client error' }, { value: '5xx', label: '5xx server error' }];
const FIELDS = ['timestamp', 'level', 'msg', 'service', 'event', 'job_id', 'job_status', 'failure_reason', 'method', 'path', 'status', 'duration_ms', 'request_id', 'error_code', 'errorType', 'errorMessage'];
const SERVICE_OPTIONS = [{ value: '', label: 'API + worker' }, { value: 'docuflow-api', label: 'API only' }, { value: 'docuflow-worker', label: 'Worker only' }];

function readFilters(search) {
  const params = new URLSearchParams(search), pick = (key, allowed) => { const value = params.get(key) || ''; return !allowed || allowed.includes(value) ? value : ''; };
  return { range: pick('range', RANGE_OPTIONS.map(option => option.value)) || '24h', level: pick('level', LEVEL_ORDER), status: pick('status', ['2xx', '3xx', '4xx', '5xx']), q: pick('q'), path: pick('path'), service: pick('service', ['docuflow-api', 'docuflow-worker']) };
}
const toQuery = filters => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();

function toCsv(rows) {
  const escape = value => { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [FIELDS.join(','), ...rows.map(row => FIELDS.map(field => escape(row[field])).join(','))].join('\n');
}

function LogDetail({ row, onFilter }) {
  const [copied, setCopied] = useState(false);
  const clean = Object.fromEntries(FIELDS.filter(field => row[field] !== undefined && row[field] !== null && row[field] !== '').map(field => [field, row[field]]));
  const copy = () => navigator.clipboard?.writeText(JSON.stringify(clean, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="log-detail">
      <dl className="kv">
        {Object.entries(clean).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      <div className="log-detail-actions">
        {row.job_id && <button className="btn secondary sm" onClick={() => onFilter({ q: row.job_id, level: '', status: '', path: '', service: '' })}><Icon name="filter" size={14} />Trace {row.job_id}</button>}
        {row.request_id && <button className="btn secondary sm" onClick={() => onFilter({ q: row.request_id, level: '', status: '', path: '', service: '' })}><Icon name="filter" size={14} />Trace this request</button>}
        {row.path && <button className="btn secondary sm" onClick={() => onFilter({ path: row.path })}><Icon name="filter" size={14} />Only {row.path}</button>}
        <button className="btn ghost sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy JSON'}</button>
      </div>
    </div>
  );
}

export function LogsPage({ search }) {
  const [filters, setFilters] = useState(() => readFilters(search));
  const [draft, setDraft] = useState({ q: filters.q, path: filters.path });
  const [data, setData] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true), [live, setLive] = useState(false), [open, setOpen] = useState(null);
  const invalid = !SAFE.test(draft.q) || !SAFE.test(draft.path);

  const update = patch => { const next = { ...filters, ...patch }; setFilters(next); setDraft({ q: next.q, path: next.path }); setOpen(null); };
  useEffect(() => { // debounce free-text filters
    if (invalid || (draft.q === filters.q && draft.path === filters.path)) return undefined;
    const id = setTimeout(() => setFilters(current => ({ ...current, q: draft.q.trim(), path: draft.path.trim() })), 400);
    return () => clearTimeout(id);
  }, [draft]);
  const load = () => {
    setLoading(true);
    return api(`/api/observability/logs?${toQuery({ ...filters, limit: '250' })}`).then(result => { setData(result); setError(null); }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(() => { window.history.replaceState({}, '', `/logs${toQuery(filters) ? `?${toQuery(filters)}` : ''}`); load(); }, [filters]);
  useInterval(load, live ? 10000 : 0);

  const levelCounts = useMemo(() => Object.fromEntries((data?.levels || []).map(row => [row.level, num(row.count)])), [data]);
  const histogram = useMemo(() => (data?.histogram || []).map(row => ({ ...row, time: row._time })), [data]);
  const levelSeries = useMemo(() => {
    const keys = new Set((data?.histogram || []).flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))));
    return [...LEVEL_ORDER.filter(key => keys.has(key)).map(key => ({ key, ...LEVEL_SERIES[key] })),
      ...[...keys].filter(key => !LEVEL_SERIES[key]).map(key => ({ key, label: key === 'NULL' || key === 'unknown' ? 'Other' : key, color: 'var(--muted)' }))];
  }, [data]);
  const facetTotal = Object.values(levelCounts).reduce((sum, value) => sum + value, 0);
  const active = filters.level || filters.status || filters.q || filters.path || filters.service;
  const errorsInView = (levelCounts.error || 0) + (levelCounts.fatal || 0);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return (
    <>
      <PageHeader spotlight eyebrow="Observability" title="Log explorer"
        subtitle={`Search structured API and worker logs from the ${RANGE_NAMES[filters.range]}.`}
        actions={<>
          <Segmented label="Time range" options={RANGE_OPTIONS} value={filters.range} onChange={range => update({ range })} />
          <label className="switch"><input type="checkbox" checked={live} onChange={event => setLive(event.target.checked)} /><span />Live tail</label>
          <button className="btn secondary" onClick={load} disabled={loading}><Icon name="refresh" className={loading ? 'spin' : ''} />Refresh</button>
        </>} />

      <Card className="filters">
        <div className="filter-row">
          <label className={`search grow ${!SAFE.test(draft.q) ? 'invalid' : ''}`}>
            <Icon name="search" />
            <input aria-label="Search log text, job ID or request ID" placeholder="Search messages, a job ID like JOB-1001, or a request ID" value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} />
            {draft.q && <button type="button" className="clear" onClick={() => update({ q: '' })} aria-label="Clear search"><Icon name="x" size={14} /></button>}
          </label>
          <label className={`search path ${!SAFE.test(draft.path) ? 'invalid' : ''}`}>
            <span className="prefix">path</span>
            <input aria-label="Filter by path prefix" placeholder="/api/jobs" value={draft.path} onChange={event => setDraft({ ...draft, path: event.target.value })} />
          </label>
          <select aria-label="Service" value={filters.service} onChange={event => update({ service: event.target.value })}>
            {SERVICE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Status class" value={filters.status} onChange={event => update({ status: event.target.value })}>
            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {invalid && <p className="field-error">Search may only contain letters, numbers, spaces and - . / : @ _</p>}
        <div className="chip-row" role="radiogroup" aria-label="Log level">
          <button type="button" role="radio" aria-checked={!filters.level} className={`chip ${!filters.level ? 'on' : ''}`} onClick={() => update({ level: '' })}>All levels{data && !filters.level && <b>{fmtInt(facetTotal)}</b>}</button>
          {['info', 'warn', 'error'].map(level => (
            <button type="button" role="radio" aria-checked={filters.level === level} key={level} className={`chip ${filters.level === level ? 'on' : ''}`} onClick={() => update({ level: filters.level === level ? '' : level })}>
              <i style={{ background: LEVEL_SERIES[level].color }} />{LEVEL_SERIES[level].label}{data && !filters.level && <b>{fmtInt(levelCounts[level] || 0)}</b>}
            </button>
          ))}
          {active && <button type="button" className="chip clear-all" onClick={() => update({ level: '', status: '', q: '', path: '', service: '' })}><Icon name="x" size={13} />Clear filters</button>}
        </div>
      </Card>

      {error && !data ? (
        <Card><Empty icon="alert" title="Logs are unavailable">{error.code === 'ROUTE_NOT_FOUND' ? 'The running API server is older than this page. Restart it (cd server && npm start).' : error.message}{error.code && <span className="error-code">{error.code}</span>}</Empty><div className="center"><button className="btn primary" onClick={load}><Icon name="refresh" />Try again</button></div></Card>
      ) : !data ? (
        <Card><Skeleton height={170} /><div className="stack">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={38} />)}</div></Card>
      ) : (
        <>
          <div className="log-summary">
            <div><span>Matching events</span><b>{fmtInt(data.total)}</b></div>
            <div><span>Errors</span><b className={errorsInView ? 'text-critical' : ''}>{fmtInt(errorsInView)}</b></div>
            <div><span>Warnings</span><b>{fmtInt(levelCounts.warn || 0)}</b></div>
            <div><span>Latest</span><b>{data.events[0]?.timestamp ? fmtRelative(data.events[0].timestamp) : '—'}</b></div>
          </div>

          <Card title="Log volume" subtitle="Events per interval by level">
            {!histogram.length || !data.total ? <Empty icon="logs" title="No log volume in this window" /> : (
              <><Legend series={levelSeries} /><ColumnChart data={histogram} series={levelSeries} height={180} xFormat={timeLabel(filters.range)} yFormat={fmtInt} label="Log volume over time by level" totalLabel="All events" /></>
            )}
          </Card>

          <Card title="Events" subtitle={data.total > data.events.length ? `Newest ${fmtInt(data.events.length)} of ${fmtInt(data.total)} · narrow the filters to see older entries` : `${fmtInt(data.events.length)} events, newest first`}
            actions={data.events.length > 0 && <>
              <button className="btn ghost sm" onClick={() => download(`docuflow-logs-${stamp}.csv`, toCsv(data.events), 'text/csv')}><Icon name="download" size={14} />CSV</button>
              <button className="btn ghost sm" onClick={() => download(`docuflow-logs-${stamp}.json`, JSON.stringify(data.events, null, 2), 'application/json')}><Icon name="download" size={14} />JSON</button>
            </>}>
            {!data.events.length ? <Empty icon="logs" title="No logs match these filters">Widen the time range or clear a filter.</Empty> : (
              <div className="log-table" role="table" aria-label="Log events">
                <div className="log-row log-head" role="row">
                  <span role="columnheader">Time</span><span role="columnheader">Level</span><span role="columnheader">Request / job</span><span role="columnheader">Status</span><span role="columnheader" className="num">Duration</span><span role="columnheader">Message</span>
                </div>
                {data.events.map((row, index) => {
                  const key = `${row.request_id || ''}-${row.timestamp}-${index}`, expanded = open === key;
                  return (
                    <div key={key} className={`log-entry ${expanded ? 'open' : ''} lvl-${row.level || 'unknown'}`} role="rowgroup">
                      <button type="button" className="log-row" role="row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                        <span role="cell" className="log-time" title={row.timestamp}><b>{row.timestamp ? fmtTime(row.timestamp, true) : '—'}</b><em>{row.timestamp ? fmtDay(row.timestamp) : ''}</em></span>
                        <span role="cell"><LevelBadge level={row.level} /></span>
                        <span role="cell" className="log-req">{row.method ? <><MethodTag method={row.method} /><code className="path">{row.path}</code></> : row.job_id ? <><span className="method">{row.service === 'docuflow-worker' ? 'WRK' : 'API'}</span><code className="path">{row.job_id}</code></> : <span className="muted">{row.service || '—'}</span>}</span>
                        <span role="cell"><StatusBadge status={row.status} /></span>
                        <span role="cell" className={`num mono ${num(row.duration_ms) > 1000 ? 'text-critical' : ''}`}>{row.duration_ms !== undefined && row.duration_ms !== '' ? fmtMs(row.duration_ms) : '—'}</span>
                        <span role="cell" className="log-msg">{row.msg}{row.failure_reason && <code className="err-code">{row.failure_reason}</code>}{row.error_code && <code className="err-code">{row.error_code}</code>}<Icon name="chevron" size={14} className="caret" /></span>
                      </button>
                      {expanded && <LogDetail row={row} onFilter={update} />}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
