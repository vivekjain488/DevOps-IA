import React, { useEffect, useState } from 'react';
import { api, linkProps, storage, store, useInterval } from './lib';
import { GlowingEffect } from './components/ui/glowing-effect';
import { Spotlight } from './components/ui/spotlight-new';

const PATHS = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  chart: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  logs: 'M4 6h16M4 12h16M4 18h10',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  pin: 'M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  x: 'M18 6 6 18M6 6l12 12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  chevron: 'm9 18 6-6-6-6',
  server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3Z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
};
export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => storage('df-theme', 'auto'));
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    store('df-theme', theme);
  }, [theme]);
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return [dark, () => setTheme(dark ? 'light' : 'dark')];
}

// Reports both containers: the API answers the health check and relays the worker's last heartbeat.
export function useHealth() {
  const [health, setHealth] = useState({ state: 'checking' });
  const check = () => api('/api/health').then(data => setHealth({ state: data.worker?.status === 'online' ? 'online' : 'degraded', data })).catch(() => setHealth({ state: 'offline' }));
  useEffect(() => { check(); }, []);
  useInterval(check, 15000);
  return health;
}
function HealthPill({ health }) {
  const text = { checking: 'Checking', online: 'API and worker online', degraded: 'Worker offline', offline: 'API unreachable' }[health.state];
  return <span className={`health ${health.state}`} title={`Service status: ${text}`}><i />{text}</span>;
}

const NAV = [
  { to: '/', label: 'Upload', icon: 'upload', match: path => path === '/' },
  { to: '/jobs', label: 'Jobs', icon: 'list', match: path => path.startsWith('/jobs') },
  { to: '/dashboard', label: 'Dashboard', icon: 'chart', match: path => path === '/dashboard' || path === '/logs-dashboard' },
  { to: '/logs', label: 'Logs', icon: 'logs', match: path => path === '/logs' }
];

function useScrolled(offset = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > offset);
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [offset]);
  return scrolled;
}

export function Shell({ path, health, children, wide = false }) {
  const [dark, toggle] = useTheme(), scrolled = useScrolled();
  return (
    <div className="app">
      <header className={scrolled ? 'topbar scrolled' : 'topbar'}>
        <div className="topbar-inner">
          <a className="brand" {...linkProps('/')} aria-label="DocuFlow home">
            <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6h8l5 5v15H10zM18 6v5h5M14 17h6M14 21h4" /></svg></span>
            <span>Docu<b>Flow</b></span>
          </a>
          <nav className="tabs" aria-label="Primary">
            {NAV.map(item => (
              <a key={item.to} {...linkProps(item.to)} className={item.match(path) ? 'tab active' : 'tab'} aria-current={item.match(path) ? 'page' : undefined}>
                <Icon name={item.icon} /><span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="topbar-end">
            <HealthPill health={health} />
            <button className="icon-btn" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title="Toggle theme">
              <Icon name={dark ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </header>
      <main className={wide ? 'page wide' : 'page'}>{children}</main>
      <footer className="footer"><span>DocuFlow · API and worker containers observed through Splunk</span><span>Uploaded files are deleted once processed; only results are kept.</span></footer>
    </div>
  );
}

// Neutral grey beams so the spotlight reads on both the light and dark surfaces.
const BEAM = alpha => `radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(240, 6%, 62%, ${alpha}) 0, hsla(240, 5%, 55%, ${alpha / 4}) 50%, hsla(240, 5%, 50%, 0) 80%)`;
const BEAM_SOFT = alpha => `radial-gradient(50% 50% at 50% 50%, hsla(240, 6%, 62%, ${alpha}) 0, hsla(240, 5%, 55%, ${alpha / 3}) 80%, transparent 100%)`;
export function PageHeader({ eyebrow, title, subtitle, actions, spotlight = false }) {
  return (
    <div className="page-header">
      {spotlight && <div className="spot-layer" aria-hidden="true"><Spotlight gradientFirst={BEAM(0.12)} gradientSecond={BEAM_SOFT(0.08)} gradientThird={BEAM_SOFT(0.05)} /></div>}
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', id }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <header className="card-head">
          <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ current, previous, invert = false, format }) {
  const now = Number(current), before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return <span className="delta flat">No prior data</span>;
  const change = ((now - before) / before) * 100;
  if (Math.abs(change) < 0.5) return <span className="delta flat">Flat vs prior</span>;
  const good = invert ? change < 0 : change > 0;
  return <span className={`delta ${good ? 'good' : 'bad'}`}>{change > 0 ? '▲' : '▼'} {format ? format(Math.abs(change)) : `${Math.abs(change).toFixed(0)}%`} <em>vs prior</em></span>;
}

export function Stat({ label, value, unit, hint, children, tone }) {
  return (
    <article className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <GlowingEffect spread={36} glow disabled={false} proximity={48} inactiveZone={0.01} borderWidth={2} />
      <span className="stat-label">{tone && <i className="status-dot" />}{label}</span>
      <strong className="stat-value">{value}{unit && <small>{unit}</small>}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
      {children}
    </article>
  );
}

export function Empty({ icon = 'chart', title, children }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={20} /></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export const Skeleton = ({ height = 16, width = '100%' }) => <span className="skeleton" style={{ height, width }} />;

export function StatusBadge({ status }) {
  const code = Number(status);
  if (!code) return <span className="badge muted">—</span>;
  const tone = code >= 500 ? 'critical' : code >= 400 ? 'serious' : code >= 300 ? 'neutral' : 'good';
  return <span className={`badge ${tone}`}>{code}</span>;
}
export function LevelBadge({ level }) {
  const value = (level || 'unknown').toLowerCase();
  const tone = { error: 'critical', fatal: 'critical', warn: 'warning', info: 'info', debug: 'neutral' }[value] || 'neutral';
  return <span className={`badge level ${tone}`}><i />{value}</span>;
}
export const MethodTag = ({ method }) => <span className={`method m-${(method || '').toLowerCase()}`}>{method || '—'}</span>;
