import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './tailwind.css';
import './style.css';
import { useLocation, linkProps } from './lib';
import { Shell, Empty } from './ui';
import { EventsPage, EventDetailPage, CreateEventPage } from './events';
import { DashboardPage } from './dashboard';
import { LogsPage } from './logs';

const TITLES = { events: 'Events', create: 'Create event', detail: 'Event', dashboard: 'Dashboard', logs: 'Logs', missing: 'Not found' };

function route(path) {
  if (path === '/' || path === '/events') return { name: 'events' };
  if (path === '/events/new') return { name: 'create' };
  const detail = path.match(/^\/events\/(\d+)$/);
  if (detail) return { name: 'detail', id: detail[1] };
  if (path === '/dashboard' || path === '/logs-dashboard') return { name: 'dashboard', wide: true };
  if (path === '/logs') return { name: 'logs', wide: true };
  return { name: 'missing' };
}

function App() {
  const { path, search } = useLocation(), current = route(path);
  useEffect(() => { document.title = `${TITLES[current.name]} · EventPulse`; }, [current.name]);
  return (
    <Shell path={path} wide={current.wide}>
      {current.name === 'events' && <EventsPage />}
      {current.name === 'create' && <CreateEventPage />}
      {current.name === 'detail' && <EventDetailPage key={current.id} id={current.id} />}
      {current.name === 'dashboard' && <DashboardPage search={search} />}
      {current.name === 'logs' && <LogsPage key={search} search={search} />}
      {current.name === 'missing' && <Empty icon="alert" title="Page not found">That page doesn’t exist. <a {...linkProps('/')}>Back to events</a></Empty>}
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
