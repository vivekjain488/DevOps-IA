import React, { useEffect, useRef, useState } from 'react';
import { api, postForm, postJson, fmtInt, fmtMs, fmtSize, fmtDate, fmtRelative, linkProps, navigate, useInterval } from './lib';
import { Icon, Empty, Skeleton, Card } from './ui';
import { ShareBar } from './charts';
import { BackgroundRippleEffect } from './components/ui/background-ripple-effect';
import { FlipWords } from './components/ui/flip-words';
import { HoverBorderGradient } from './components/ui/hover-border-gradient';

const CELL = 56;
const MAX_BYTES = 5 * 1024 * 1024;
const ACTIVE = ['QUEUED', 'PROCESSING'];
const STATUS_TONE = { QUEUED: 'neutral', PROCESSING: 'warning', COMPLETED: 'good', FAILED: 'critical' };
const REASONS = {
  UNSUPPORTED_FILE_TYPE: 'Unsupported file type', FILE_TOO_LARGE: 'File larger than 5 MB', EMPTY_FILE: 'Empty file', MALFORMED_CSV: 'Malformed CSV',
  CORRUPTED_FILE: 'Corrupted file', FILE_MISSING: 'Upload missing', DEMO_INTENTIONAL_FAILURE: 'Intentional demo failure', WORKER_RESTARTED: 'Worker restarted mid-job', PROCESSING_ERROR: 'Unexpected worker error'
};
export const reasonLabel = code => REASONS[code] || code;

function useGridColumns() {
  const count = () => Math.ceil(window.innerWidth / CELL) + 2;
  const [cols, setCols] = useState(count);
  useEffect(() => { const resize = () => setCols(count()); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return cols;
}

export function StatusPill({ status }) {
  return <span className={`pill job-status ${STATUS_TONE[status] || 'neutral'} ${status === 'PROCESSING' ? 'pulsing' : ''}`}><i />{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}
const TypeTag = ({ type }) => <span className={`method type-${type}`}>{(type || '—').toUpperCase()}</span>;

function useJobs(query, fast) {
  const [jobs, setJobs] = useState(null), [error, setError] = useState('');
  const load = () => api(`/api/jobs?${query}`).then(data => { setJobs(data); setError(''); }).catch(err => setError(err.message));
  useEffect(() => { load(); }, [query]);
  // Poll quickly while anything is still moving through the queue.
  useInterval(load, jobs && jobs.some(job => ACTIVE.includes(job.status)) ? 1500 : fast ? 5000 : 10000);
  return { jobs, error, load };
}

function JobRows({ jobs }) {
  return (
    <ul className="job-list">
      {jobs.map(job => (
        <li key={job.jobId}>
          <a {...linkProps(`/jobs/${job.jobId}`)} className={`job-row ${job.status.toLowerCase()}`}>
            <StatusPill status={job.status} />
            <span className="job-name"><code>{job.jobId}</code><b title={job.fileName}>{job.fileName}</b>{job.demo && <span className="badge neutral">demo</span>}</span>
            <TypeTag type={job.fileType} />
            <span className="job-meta">{fmtSize(job.fileSizeBytes)}</span>
            <span className="job-meta">
              {job.status === 'FAILED' ? <span className="text-critical">{reasonLabel(job.failureReason)}</span>
                : job.processingDurationMs !== null ? fmtMs(job.processingDurationMs) : job.status === 'PROCESSING' ? 'Processing…' : 'Waiting…'}
            </span>
            <span className="job-meta muted" title={fmtDate(job.queuedAt)}>{fmtRelative(job.queuedAt)}</span>
            <Icon name="chevron" size={15} className="caret" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function UploadBox({ onUploaded }) {
  const input = useRef(null);
  const [file, setFile] = useState(null), [over, setOver] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ext = file ? (file.name.split('.').pop() || '').toLowerCase() : '';
  // The API is the authority; these hints only warn, so invalid uploads can still be sent to demonstrate rejections.
  const warning = !file ? '' : !['csv', 'txt'].includes(ext) ? 'This type will be rejected: only .csv and .txt are processed.' : file.size > MAX_BYTES ? 'This file is over 5 MB and will be rejected.' : file.size === 0 ? 'This file is empty, so the worker will fail it.' : '';
  const choose = files => { if (files && files[0]) { setFile(files[0]); setError(''); } };
  const submit = async () => {
    const body = new FormData(); body.append('file', file); setBusy(true); setError('');
    try { const job = await postForm('/api/jobs', body); onUploaded(job); }
    catch (err) { if (err.data?.jobId) onUploaded(err.data); else setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className={`dropzone ${over ? 'over' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); choose(event.dataTransfer.files); }}>
      <input ref={input} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={event => choose(event.target.files)} />
      {!file ? (
        <button type="button" className="dropzone-empty" onClick={() => input.current.click()}>
          <span className="dropzone-icon"><Icon name="upload" size={22} /></span>
          <b>Drop a CSV or TXT file here</b>
          <span>or click to browse · up to 5 MB</span>
        </button>
      ) : (
        <div className="dropzone-file">
          <span className="dropzone-icon"><Icon name="file" size={20} /></span>
          <div className="dropzone-name"><b title={file.name}>{file.name}</b><span>{fmtSize(file.size)}{ext ? ` · .${ext}` : ''}</span></div>
          <button type="button" className="icon-btn" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }} aria-label="Remove file"><Icon name="x" size={15} /></button>
          <HoverBorderGradient as="button" type="button" onClick={submit} disabled={busy} containerClassName="hbg" className="hbg-inner"><Icon name="upload" />{busy ? 'Uploading…' : 'Process file'}</HoverBorderGradient>
        </div>
      )}
      {warning && <p className="notice warning dropzone-note"><Icon name="alert" />{warning}</p>}
      {error && <p className="notice critical dropzone-note" role="alert"><Icon name="alert" />{error}</p>}
    </div>
  );
}

const DEMOS = [
  { route: 'fail-job', label: 'Failed job', icon: 'alert', text: 'Worker fails it on purpose' },
  { route: 'slow-job', label: 'Slow job', icon: 'clock', text: 'Takes ~8 s, builds a queue' },
  { route: 'crash-worker', label: 'Crash worker', icon: 'bolt', text: 'Docker restarts the container' }
];
function DemoPanel() {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const run = async route => {
    setBusy(route); setError('');
    try { const job = await postJson(`/api/demo/${route}`, {}); navigate(`/jobs/${job.jobId}`); } catch (err) { setError(err.message); setBusy(''); }
  };
  return (
    <Card title="Demo scenarios" subtitle="Generate controlled evidence for the Splunk dashboard">
      <div className="demo-grid">
        {DEMOS.map(demo => (
          <button key={demo.route} type="button" className="demo-btn" disabled={!!busy} onClick={() => run(demo.route)}>
            <Icon name={demo.icon} /><span><b>{busy === demo.route ? 'Queuing…' : demo.label}</b><em>{demo.text}</em></span>
          </button>
        ))}
      </div>
      {error && <p className="notice critical" role="alert"><Icon name="alert" />{error}</p>}
    </Card>
  );
}

function QueueStats() {
  const [stats, setStats] = useState(null);
  const load = () => api('/api/jobs/stats').then(setStats).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 3000);
  if (!stats) return null;
  const s = stats.byStatus;
  return (
    <div className="queue-stats">
      <div><span>Jobs</span><b>{fmtInt(stats.total)}</b></div>
      <div><span>Completed</span><b className="text-good">{fmtInt(s.COMPLETED)}</b></div>
      <div><span>Failed</span><b className={s.FAILED ? 'text-critical' : ''}>{fmtInt(s.FAILED)}</b></div>
      <div><span>In queue</span><b>{fmtInt(s.QUEUED + s.PROCESSING)}</b></div>
      <div><span>Avg processing</span><b>{stats.avgProcessingMs !== null ? fmtMs(stats.avgProcessingMs) : '—'}</b></div>
      <div><span>Worker</span><b className={`cap ${stats.worker.status === 'online' ? 'text-good' : 'text-critical'}`}>{stats.worker.status}</b></div>
    </div>
  );
}

export function UploadPage({ demoMode }) {
  const cols = useGridColumns();
  const { jobs, error } = useJobs('limit=8', true);
  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"><BackgroundRippleEffect rows={9} cols={cols} cellSize={CELL} /></div>
        <div className="hero-copy">
          <p className="eyebrow">File processing service</p>
          <h1>Upload a file, get<br /><FlipWords words={['row counts.', 'missing values.', 'word counts.', 'duplicates.']} className="flip" /></h1>
          <p className="subtitle">The API queues your file and a separate worker container analyses it in the background. Every stage is logged to Splunk.</p>
        </div>
      </section>
      <div className="upload-layout">
        <UploadBox onUploaded={job => navigate(`/jobs/${job.jobId}`)} />
        <QueueStats />
      </div>
      <div className="upload-grid">
        <Card title="Recent jobs" subtitle="Updates live while jobs are queued or processing" actions={<a className="btn ghost sm" {...linkProps('/jobs')}>All jobs<Icon name="chevron" size={14} /></a>}>
          {error ? <Empty icon="alert" title="Jobs could not be loaded">{error}</Empty>
            : !jobs ? <div className="stack">{[0, 1, 2].map(i => <Skeleton key={i} height={44} />)}</div>
              : !jobs.length ? <Empty icon="file" title="No jobs yet">Upload a file above to create the first job.</Empty>
                : <JobRows jobs={jobs} />}
        </Card>
        {demoMode && <DemoPanel />}
      </div>
    </>
  );
}

const FILTERS = [{ value: '', label: 'All' }, { value: 'QUEUED', label: 'Queued' }, { value: 'PROCESSING', label: 'Processing' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'FAILED', label: 'Failed' }];
export function JobsPage() {
  const [status, setStatus] = useState('');
  const { jobs, error } = useJobs(`limit=100${status ? `&status=${status}` : ''}`);
  return (
    <>
      <div className="page-header">
        <div><p className="eyebrow">Processing</p><h1>Jobs</h1><p className="subtitle">Every upload becomes a job. Rejected uploads are recorded as failed jobs with the reason.</p></div>
        <div className="page-actions"><a className="btn primary" {...linkProps('/')}><Icon name="upload" />Upload file</a></div>
      </div>
      <div className="chip-row" role="radiogroup" aria-label="Job status">
        {FILTERS.map(filter => <button key={filter.value} type="button" role="radio" aria-checked={status === filter.value} className={`chip ${status === filter.value ? 'on' : ''}`} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}
      </div>
      <Card>
        {error ? <Empty icon="alert" title="Jobs could not be loaded">{error}</Empty>
          : !jobs ? <div className="stack">{[0, 1, 2, 3].map(i => <Skeleton key={i} height={44} />)}</div>
            : !jobs.length ? <Empty icon="file" title={status ? `No ${status.toLowerCase()} jobs` : 'No jobs yet'}>{status ? 'Try another status.' : 'Upload a file to create one.'}</Empty>
              : <JobRows jobs={jobs} />}
      </Card>
    </>
  );
}

function Lifecycle({ job }) {
  const failed = job.status === 'FAILED', rejected = failed && job.failureStage === 'validation';
  const steps = [
    { key: 'QUEUED', label: rejected ? 'Uploaded' : 'Queued', at: job.queuedAt, state: 'done' },
    { key: 'PROCESSING', label: 'Processing', at: job.startedAt, state: rejected ? 'skipped' : job.startedAt ? 'done' : 'pending' },
    { key: 'END', label: rejected ? 'Rejected' : failed ? 'Failed' : 'Completed', at: job.completedAt, state: failed ? 'failed' : job.status === 'COMPLETED' ? 'done' : 'pending' }
  ];
  if (job.status === 'PROCESSING') steps[1].state = 'active';
  if (job.status === 'QUEUED') steps[0].state = 'active';
  return (
    <ol className="lifecycle" aria-label="Job lifecycle">
      {steps.map(step => (
        <li key={step.key} className={step.state}>
          <span className="lc-dot">{step.state === 'done' ? <Icon name="check" size={13} /> : step.state === 'failed' ? <Icon name="x" size={13} /> : null}</span>
          <b>{step.label}</b>
          <em>{step.at ? fmtDate(step.at) : step.state === 'skipped' ? 'Skipped' : step.state === 'active' ? 'In progress' : 'Waiting'}</em>
        </li>
      ))}
    </ol>
  );
}

const Metric = ({ label, value, tone }) => <div className="metric"><span>{label}</span><b className={tone ? `text-${tone}` : ''}>{value}</b></div>;

function Results({ job }) {
  if (job.fileType === 'csv') return (
    <>
      <div className="metric-grid">
        <Metric label="Rows" value={fmtInt(job.rowCount)} />
        <Metric label="Columns" value={fmtInt(job.columnCount)} />
        <Metric label="Missing values" value={fmtInt(job.missingValues)} tone={job.missingValues ? 'warning' : ''} />
        <Metric label="Duplicate rows" value={fmtInt(job.duplicateRows)} tone={job.duplicateRows ? 'warning' : ''} />
      </div>
      <h3 className="section-label">Headers</h3>
      <div className="header-chips">{job.headers.map((name, index) => <code key={index}>{name || <em>(blank)</em>}</code>)}</div>
    </>
  );
  const max = Math.max(1, ...job.topWords.map(word => word.count));
  return (
    <>
      <div className="metric-grid three">
        <Metric label="Lines" value={fmtInt(job.lineCount)} />
        <Metric label="Words" value={fmtInt(job.wordCount)} />
        <Metric label="Characters" value={fmtInt(job.characterCount)} />
      </div>
      <h3 className="section-label">Top repeated words</h3>
      {!job.topWords.length ? <p className="muted">No word appears more than once.</p> : (
        <ul className="bar-list">
          {job.topWords.map(word => (
            <li key={word.word}><div className="bar-list-head"><code>{word.word}</code><span className="bar-list-value">{fmtInt(word.count)}</span></div><ShareBar value={word.count} max={max} /></li>
          ))}
        </ul>
      )}
    </>
  );
}

export function JobDetailPage({ id }) {
  const [job, setJob] = useState(null), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const load = () => api(`/api/jobs/${encodeURIComponent(id)}`).then(setJob).catch(err => setError(err.message));
  useEffect(() => { load(); }, [id]);
  useInterval(load, job && ACTIVE.includes(job.status) ? 1000 : 0);
  const back = <a className="back" {...linkProps('/jobs')}><Icon name="arrowLeft" />All jobs</a>;
  if (error) return <>{back}<Empty icon="alert" title="Job unavailable">{error}</Empty></>;
  if (!job) return <div className="detail-main"><Skeleton height={36} width="50%" /><Skeleton height={80} /><Skeleton height={160} /></div>;
  const json = JSON.stringify(Object.fromEntries(Object.entries(job).filter(([, value]) => value !== null)), null, 2);
  const copy = () => navigator.clipboard?.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <>
      {back}
      <div className="job-head">
        <div>
          <p className="eyebrow">{job.jobId}{job.demo ? ` · demo ${job.demo}` : ''}</p>
          <h1 title={job.fileName}>{job.fileName}</h1>
        </div>
        <StatusPill status={job.status} />
      </div>
      <ul className="facts">
        <li><Icon name="file" /><div><span>Type and size</span><b>.{job.fileType} · {fmtSize(job.fileSizeBytes)}</b></div></li>
        <li><Icon name="clock" /><div><span>Queue time</span><b>{job.queueTimeMs !== null ? fmtMs(job.queueTimeMs) : '—'}</b></div></li>
        <li><Icon name="bolt" /><div><span>Processing time</span><b>{job.processingDurationMs !== null ? fmtMs(job.processingDurationMs) : '—'}</b></div></li>
        <li><Icon name="server" /><div><span>Worker</span><b title={job.worker || ''}>{job.worker || (job.failureStage === 'validation' ? 'Rejected by API' : 'Not assigned')}</b></div></li>
      </ul>
      <Card><Lifecycle job={job} /></Card>
      <div className="detail-grid">
        <Card title={job.status === 'FAILED' ? 'Failure' : 'Results'} subtitle={job.status === 'COMPLETED' ? `Processed in ${fmtMs(job.processingDurationMs)}` : null}>
          {job.status === 'COMPLETED' ? <Results job={job} />
            : job.status === 'FAILED' ? (
              <div className="failure">
                <p className="notice critical"><Icon name="alert" /><span><b>{reasonLabel(job.failureReason)}</b> — {job.failureMessage}</span></p>
                <dl className="facts-list">
                  <div><dt>Reason code</dt><dd><code>{job.failureReason}</code></dd></div>
                  <div><dt>Failed during</dt><dd>{job.failureStage === 'validation' ? 'Upload validation (API)' : 'Processing (worker)'}</dd></div>
                </dl>
              </div>
            ) : <Empty icon={job.status === 'QUEUED' ? 'clock' : 'refresh'} title={job.status === 'QUEUED' ? 'Waiting for the worker' : 'Worker is processing this file'}>This page refreshes every second until the job finishes.</Empty>}
        </Card>
        <Card title="API response" subtitle={`GET /api/jobs/${job.jobId}`} actions={<button className="btn ghost sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button>}>
          <pre className="json">{json}</pre>
          <a className="btn secondary sm" {...linkProps(`/logs?range=24h&q=${job.jobId}`)}><Icon name="logs" size={14} />View logs for {job.jobId}</a>
        </Card>
      </div>
    </>
  );
}
