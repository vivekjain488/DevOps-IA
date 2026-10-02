import React, { useEffect, useState } from 'react';
import { api, postJson, fmtDate, linkProps, navigate, useIsDark } from './lib';
import { Icon, Empty, Skeleton } from './ui';
import { BackgroundRippleEffect } from './components/ui/background-ripple-effect';
import { FlipWords } from './components/ui/flip-words';
import { HoverBorderGradient } from './components/ui/hover-border-gradient';
import { GlowingEffect } from './components/ui/glowing-effect';
import { CanvasRevealEffect } from './components/ui/canvas-reveal-effect';

const CELL = 56;
// Grey dot palettes for the reservation card, one per theme (RGB 0-255, as Canvas Reveal expects).
const DOTS_DARK = [[161, 161, 170], [228, 228, 231]];
const DOTS_LIGHT = [[63, 63, 70], [113, 113, 122]];
const DOT_OPACITIES = [0.18, 0.22, 0.26, 0.3, 0.36, 0.42, 0.5, 0.6, 0.75, 1];
function useGridColumns() {
  const count = () => Math.ceil(window.innerWidth / CELL) + 2;
  const [cols, setCols] = useState(count);
  useEffect(() => { const resize = () => setCols(count()); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return cols;
}

const monthDay = value => { const date = new Date(value); return { month: date.toLocaleString('en-IN', { month: 'short' }).toUpperCase(), day: date.getDate(), weekday: date.toLocaleString('en-IN', { weekday: 'short' }) }; };
const timeOf = value => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
function availability(event) {
  if (event.seatsRemaining <= 0) return { tone: 'critical', label: 'Sold out' };
  if (event.percentageFull >= 90) return { tone: 'serious', label: 'Almost full' };
  if (event.percentageFull >= 70) return { tone: 'warning', label: 'Filling fast' };
  return { tone: 'good', label: 'Open' };
}
const fieldErrors = error => Object.fromEntries((error?.details || []).filter(item => item.field).map(item => [item.field, item.message]));

function Capacity({ event }) {
  const state = availability(event);
  return (
    <div className="capacity">
      <div className="capacity-row">
        <span><b>{event.registeredCount}</b> / {event.capacity} registered</span>
        <span className={`pill ${state.tone}`}><i />{state.label}</span>
      </div>
      <div className="meter" role="progressbar" aria-valuenow={Math.round(event.percentageFull)} aria-valuemin="0" aria-valuemax="100" aria-label="Seats filled">
        <i className={state.tone} style={{ width: `${Math.max(event.percentageFull, 1.5)}%` }} />
      </div>
    </div>
  );
}

export function EventsPage() {
  const [events, setEvents] = useState(null), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [error, setError] = useState('');
  useEffect(() => { const id = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(id); }, [search]);
  useEffect(() => {
    let live = true; setError('');
    api(`/api/events?search=${encodeURIComponent(query)}&limit=50`).then(data => live && setEvents(data)).catch(err => live && setError(err.message));
    return () => { live = false; };
  }, [query]);
  const cols = useGridColumns();
  const seats = (events || []).reduce((sum, event) => sum + event.seatsRemaining, 0);
  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"><BackgroundRippleEffect rows={9} cols={cols} cellSize={CELL} /></div>
        <div className="hero-copy">
          <p className="eyebrow">Upcoming experiences</p>
          <h1>Find your next great<br /><FlipWords words={['meetup.', 'workshop.', 'forum.', 'community event.']} className="flip" /></h1>
          <p className="subtitle">Meetups, forums and workshops for builders and operators. Reserve a seat in seconds.</p>
        </div>
        <div className="hero-tools">
          <label className="search">
            <Icon name="search" />
            <input aria-label="Search events or venues" placeholder="Search events or venues" value={search} onChange={event => setSearch(event.target.value)} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
          </label>
          <HoverBorderGradient as="a" {...linkProps('/events/new')} containerClassName="hbg" className="hbg-inner"><Icon name="plus" />Create event</HoverBorderGradient>
        </div>
        {events && <p className="hero-meta"><b>{events.length}</b> upcoming {events.length === 1 ? 'event' : 'events'} · <b>{seats}</b> seats available</p>}
      </section>

      {error ? (
        <Empty icon="alert" title="Events could not be loaded">{error}</Empty>
      ) : !events ? (
        <div className="event-grid">{[0, 1, 2].map(i => <div className="event-card" key={i}><Skeleton height={56} width={56} /><Skeleton height={22} width="70%" /><Skeleton height={14} width="50%" /><Skeleton height={40} /></div>)}</div>
      ) : !events.length ? (
        <Empty icon="calendar" title={query ? `No events match “${query}”` : 'No upcoming events yet'}>
          {query ? 'Try a different title or venue.' : 'Create the first one and it will appear here.'}
        </Empty>
      ) : (
        <div className="event-grid">
          {events.map(event => {
            const date = monthDay(event.eventDate);
            return (
              <a className="event-card" key={event.id} {...linkProps(`/events/${event.id}`)}>
                <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
                <div className="event-top">
                  <div className="date-tile"><span>{date.month}</span><b>{date.day}</b></div>
                  <div className="event-when"><span>{date.weekday} · {timeOf(event.eventDate)}</span><span className="event-venue"><Icon name="pin" size={14} />{event.venue}</span></div>
                </div>
                <h2>{event.title}</h2>
                {event.description && <p className="event-desc">{event.description}</p>}
                <Capacity event={event} />
                <span className="event-cta">{event.seatsRemaining ? 'View & register' : 'View details'}<Icon name="arrowRight" size={15} /></span>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

export function EventDetailPage({ id }) {
  const dark = useIsDark();
  const [event, setEvent] = useState(null), [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '' }), [errors, setErrors] = useState({}), [message, setMessage] = useState(null), [busy, setBusy] = useState(false);
  const load = () => api(`/api/events/${encodeURIComponent(id)}`).then(setEvent).catch(err => setError(err.message));
  useEffect(() => { load(); }, [id]);
  const submit = async submitEvent => {
    submitEvent.preventDefault(); setBusy(true); setErrors({}); setMessage(null);
    try { await postJson(`/api/events/${event.id}/register`, form); setMessage({ tone: 'good', text: `You're registered, ${form.name.split(' ')[0]}! See you there.` }); setForm({ name: '', email: '' }); load(); }
    catch (err) { setErrors(fieldErrors(err)); setMessage({ tone: 'critical', text: err.message }); }
    finally { setBusy(false); }
  };
  if (error) return <><a className="back" {...linkProps('/')}><Icon name="arrowLeft" />All events</a><Empty icon="alert" title="Event unavailable">{error}</Empty></>;
  if (!event) return <div className="detail"><div className="detail-main"><Skeleton height={36} width="60%" /><Skeleton height={18} width="40%" /><Skeleton height={120} /></div></div>;
  const date = monthDay(event.eventDate), full = event.seatsRemaining <= 0;
  return (
    <>
      <a className="back" {...linkProps('/')}><Icon name="arrowLeft" />All events</a>
      <div className="detail">
        <div className="detail-main">
          <p className="eyebrow">{date.weekday}, {date.day} {date.month}</p>
          <h1>{event.title}</h1>
          <ul className="facts">
            <li><Icon name="clock" /><div><span>When</span><b>{fmtDate(event.eventDate)}</b></div></li>
            <li><Icon name="pin" /><div><span>Where</span><b>{event.venue}</b></div></li>
            <li><Icon name="users" /><div><span>Seats left</span><b>{event.seatsRemaining} of {event.capacity}</b></div></li>
          </ul>
          <h3>About this event</h3>
          <p className="prose">{event.description || 'The organiser has not added a description yet.'}</p>
          <Capacity event={event} />
        </div>
        <aside className="detail-side">
          <div className={`reveal-card ${full ? 'is-full' : ''}`}>
            <CanvasRevealEffect animationSpeed={3} containerClassName="reveal-canvas" colors={dark ? DOTS_DARK : DOTS_LIGHT} totalSize={40} dotSize={5} opacities={DOT_OPACITIES} showGradient={false} />
            <div className="reveal-badge" aria-hidden="true"><span>{date.month}</span><b>{date.day}</b></div>
            <form className="reveal-form" onSubmit={submit} noValidate>
              <div className="reveal-title">
                <h2>{full ? 'This event is full' : 'Reserve your seat'}</h2>
                <Icon name="arrowRight" size={18} />
              </div>
              <p className="muted">{full ? 'All seats have been claimed. Check back later or explore other events.' : `Free registration · ${event.seatsRemaining} of ${event.capacity} seats left`}</p>
              <Field label="Full name" error={errors.name}><input required minLength="2" maxLength="80" autoComplete="name" value={form.name} disabled={full} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ada Lovelace" /></Field>
              <Field label="Email" error={errors.email}><input required type="email" autoComplete="email" value={form.email} disabled={full} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></Field>
              <button className="btn primary block" disabled={full || busy}>{busy ? 'Reserving…' : full ? 'Event full' : 'Reserve my seat'}</button>
              {message && <p className={`notice ${message.tone}`} role="status"><Icon name={message.tone === 'good' ? 'check' : 'alert'} />{message.text}</p>}
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className={`field ${error ? 'invalid' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

const localMin = () => { const date = new Date(Date.now() + 3600000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
export function CreateEventPage() {
  const [form, setForm] = useState({ title: '', venue: '', eventDate: '', capacity: '50', description: '' }), [errors, setErrors] = useState({}), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const set = key => event => setForm({ ...form, [key]: event.target.value });
  const submit = async event => {
    event.preventDefault(); setBusy(true); setErrors({}); setMessage('');
    try {
      const created = await postJson('/api/events', { ...form, capacity: Number(form.capacity), eventDate: form.eventDate ? new Date(form.eventDate).toISOString() : '' });
      navigate(`/events/${created.id}`);
    } catch (err) { setErrors(fieldErrors(err)); setMessage(err.message); setBusy(false); }
  };
  return (
    <>
      <a className="back" {...linkProps('/')}><Icon name="arrowLeft" />All events</a>
      <div className="narrow">
        <p className="eyebrow">New event</p>
        <h1>Create an event</h1>
        <p className="subtitle">It goes live in the listing immediately and opens for registration.</p>
        <form className="card form" onSubmit={submit} noValidate>
          <Field label="Title" error={errors.title} hint="3–100 characters"><input required value={form.title} onChange={set('title')} placeholder="Mumbai DevOps Meetup" /></Field>
          <Field label="Venue" error={errors.venue}><input required value={form.venue} onChange={set('venue')} placeholder="Somaiya Vidyavihar, Ghatkopar" /></Field>
          <div className="form-row">
            <Field label="Date and time" error={errors.eventDate}><input required type="datetime-local" min={localMin()} value={form.eventDate} onChange={set('eventDate')} /></Field>
            <Field label="Capacity" error={errors.capacity} hint="1–1000 seats"><input required type="number" min="1" max="1000" value={form.capacity} onChange={set('capacity')} /></Field>
          </div>
          <Field label="Description" error={errors.description} hint={`${form.description.length}/500`}><textarea rows="4" maxLength="500" value={form.description} onChange={set('description')} placeholder="What will attendees learn or do?" /></Field>
          {message && <p className="notice critical" role="alert"><Icon name="alert" />{message}</p>}
          <div className="form-actions">
            <a className="btn ghost" {...linkProps('/')}>Cancel</a>
            <button className="btn primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish event'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
