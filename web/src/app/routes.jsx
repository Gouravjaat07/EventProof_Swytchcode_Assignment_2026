import { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { App } from './App.jsx';
import { Spinner } from '../components/ui.jsx';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage.jsx').then((m) => ({ default: m.DashboardPage })));
const EventsPage = lazy(() => import('../features/events/EventsPage.jsx').then((m) => ({ default: m.EventsPage })));
const VerifyPage = lazy(() => import('../features/verification/VerifyPage.jsx').then((m) => ({ default: m.VerifyPage })));
const HistoryPage = lazy(() => import('../features/history/HistoryPage.jsx').then((m) => ({ default: m.HistoryPage })));
const HistoryDetailPage = lazy(() => import('../features/history/HistoryDetailPage.jsx').then((m) => ({ default: m.HistoryDetailPage })));
const StatusPage = lazy(() => import('../features/integrations/StatusPage.jsx').then((m) => ({ default: m.StatusPage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.jsx').then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import('../features/misc/NotFoundPage.jsx').then((m) => ({ default: m.NotFoundPage })));

function suspended(element) {
  return <Suspense fallback={<Spinner label="Loading page…" />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: suspended(<DashboardPage />) },
      { path: 'events', element: suspended(<EventsPage />) },
      { path: 'verify', element: suspended(<VerifyPage />) },
      { path: 'history', element: suspended(<HistoryPage />) },
      { path: 'history/:verificationId', element: suspended(<HistoryDetailPage />) },
      { path: 'integrations', element: suspended(<StatusPage />) },
      { path: 'settings', element: suspended(<SettingsPage />) },
      { path: '*', element: suspended(<NotFoundPage />) },
    ],
  },
]);
