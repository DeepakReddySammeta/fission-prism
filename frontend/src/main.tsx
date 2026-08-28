import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { AppShell } from './shell/AppShell';
import { AuthProvider } from './auth/AuthContext';
import { PlannerProvider } from './planner/PlannerContext';
import PlansGallery from './pages/PlansGallery';
import PlanDetail from './pages/PlanDetail';
import MyBookings from './pages/MyBookings';
import MyActivity from './pages/MyActivity';
import MyAppointments from './pages/MyAppointments';
import InlinePlans from './components/activity/InlinePlans';
import InlineBookings from './components/activity/InlineBookings';
import InlineAppointments from './components/activity/InlineAppointments';
import './styles.css';

// A production build with no VITE_API_URL silently points every request at
// localhost:8787 — surface that loudly instead of a page that just fails.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  // eslint-disable-next-line no-console
  console.error(
    '[config] VITE_API_URL was not set at build time — API calls will target '
    + 'http://localhost:8787 and fail. Rebuild with VITE_API_URL=<backend URL>.',
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      {/* Above the router so the conversation survives navigating to My
          Plans / My Bookings and back — it used to live inside App.tsx,
          which unmounted (and lost every turn) on any route change. */}
      <PlannerProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<App />} />
              <Route path="/explore" element={<App />} />
              <Route path="/plans" element={<PlansGallery />} />
              <Route path="/plans/:id" element={<PlanDetail />} />
              <Route path="/bookings" element={<MyBookings />} />
              <Route path="/appointments" element={<MyAppointments />} />
              <Route path="/activity" element={<MyActivity />}>
              <Route path="plans" element={<InlinePlans />} />
              <Route path="bookings" element={<InlineBookings />} />
              <Route path="appointments" element={<InlineAppointments />} />
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PlannerProvider>
    </AuthProvider>
  </React.StrictMode>
);
