import { useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(body, status) {
    super(body?.error?.message || 'Request failed.');
    this.status = status; this.code = body?.error?.code; this.details = body?.error?.details || []; this.data = body?.data;
  }
}

export async function api(url, options) {
  let response;
  try { response = await fetch(url, options); } catch (_) { throw new ApiError({ error: { message: 'Could not reach the server. Check your connection.' } }, 0); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body, response.status);
  return body.data;
}
export const postJson = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const postForm = (url, form) => api(url, { method: 'POST', body: form });

// Tiny pathname router: links call navigate(), the back button fires popstate.
export function navigate(to) { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0 }); }
export function useLocation() {
  const read = () => ({ path: window.location.pathname, search: window.location.search });
  const [location, setLocation] = useState(read);
  useEffect(() => { const update = () => setLocation(read()); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return location;
}
export const linkProps = to => ({ href: to, onClick: event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); navigate(to); } });

export function useElementWidth() {
  const ref = useRef(null), [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function useInterval(callback, ms) {
  const saved = useRef(callback); saved.current = callback;
  useEffect(() => { if (!ms) return undefined; const id = setInterval(() => saved.current(), ms); return () => clearInterval(id); }, [ms]);
}

export function storage(key, fallback) {
  try { return window.localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
export function store(key, value) { try { window.localStorage.setItem(key, value); } catch (_) { /* storage is optional */ } }

const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
export { num };
export const fmtInt = value => new Intl.NumberFormat('en-IN').format(Math.round(num(value)));
export const fmtCompact = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num(value));
export const fmtMs = value => { const n = num(value); return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ms`; };
// Compact axis labels: 0, 250 ms, 1 s, 2.5 s — no trailing zeros.
export const fmtAxisMs = value => { const n = num(value); if (n === 0) return '0'; if (n >= 1000) return `${Number((n / 1000).toFixed(1))} s`; return `${Number(n.toFixed(n < 10 ? 1 : 0))} ms`; };
export const fmtPct = (value, digits = 1) => `${num(value).toFixed(digits)}%`;
export const fmtBytes = value => { const n = num(value); if (n < 1024) return `${Math.round(n)} B/s`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB/s`; return `${(n / 1048576).toFixed(1)} MB/s`; };
export const fmtSize = value => { const n = num(value); if (n < 1024) return `${Math.round(n)} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(2)} MB`; };
export function fmtDuration(seconds) {
  const s = Math.floor(num(seconds)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`; if (h) return `${h}h ${m}m`; if (m) return `${m}m ${s % 60}s`; return `${s}s`;
}
export const fmtDate = value => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export const fmtTime = (value, withSeconds = false) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false }).format(new Date(value));
export const fmtDay = value => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(value));
export function fmtRelative(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 45) return 'just now'; if (diff < 3600) return `${Math.round(diff / 60)} min ago`; if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return fmtDate(value);
}
// Splunk timechart rows carry _time like "2026-10-03 13:43:00.000 GMT"; normalise to epoch ms so every browser parses it.
export function splunkTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) (GMT|UTC)$/.exec(String(value || ''));
  return match ? Date.parse(`${match[1]}T${match[2]}Z`) : Date.parse(value);
}
// Pick a tick/tooltip label that suits the window being shown.
export const timeLabel = range => value => (range === '7d' ? `${fmtDay(value)} ${fmtTime(value)}` : fmtTime(value));

export const RANGE_OPTIONS = [{ value: '1h', label: '1H' }, { value: '6h', label: '6H' }, { value: '24h', label: '24H' }, { value: '7d', label: '7D' }];
export const RANGE_NAMES = { '1h': 'last hour', '6h': 'last 6 hours', '24h': 'last 24 hours', '7d': 'last 7 days' };

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tracks the effective theme: an explicit data-theme on <html> wins, otherwise the OS preference.
export function useIsDark() {
  const read = () => { const theme = document.documentElement.getAttribute('data-theme'); return theme ? theme === 'dark' : !!window.matchMedia?.('(prefers-color-scheme: dark)').matches; };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const update = () => setDark(read());
    const observer = new MutationObserver(update); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)'); media?.addEventListener('change', update);
    return () => { observer.disconnect(); media?.removeEventListener('change', update); };
  }, []);
  return dark;
}
