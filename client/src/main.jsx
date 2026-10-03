import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './tailwind.css';
import './style.css';
import { useLocation, linkProps } from './lib';
import { Shell, Empty, useHealth } from './ui';
import { UploadPage, JobsPage, JobDetailPage } from './jobs';
import { DashboardPage } from './dashboard';
import { LogsPage } from './logs';

const TITLES = { upload: 'Upload', jobs: 'Jobs', detail: 'Job', dashboard: 'Dashboard', logs: 'Logs', missing: 'Not found' };

function route(path) {
  if (path === '/') return { name: 'upload' };
  if (path === '/jobs') return { name: 'jobs' };
  const detail = path.match(/^\/jobs\/(JOB-\d+)$/i);
  if (detail) return { name: 'detail', id: detail[1].toUpperCase() };
  if (path === '/dashboard') return { name: 'dashboard', wide: true };
  if (path === '/logs') return { name: 'logs', wide: true };
  return { name: 'missing' };
}

function App() {
  const { path, search } = useLocation(), current = route(path), health = useHealth();
  useEffect(() => { document.title = `${current.name === 'detail' ? current.id : TITLES[current.name]} · DocuFlow`; }, [current.name, current.id]);
  return (
    <Shell path={path} health={health} wide={current.wide}>
      {current.name === 'upload' && <UploadPage demoMode={!!health.data?.demoMode} />}
      {current.name === 'jobs' && <JobsPage />}
      {current.name === 'detail' && <JobDetailPage key={current.id} id={current.id} />}
      {current.name === 'dashboard' && <DashboardPage search={search} />}
      {current.name === 'logs' && <LogsPage key={search} search={search} />}
      {current.name === 'missing' && <Empty icon="alert" title="Page not found">That page doesn’t exist. <a {...linkProps('/')}>Back to upload</a></Empty>}
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
