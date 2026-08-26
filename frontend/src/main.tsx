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
import './styles.css';

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
              <Route path="/plans" element={<PlansGallery />} />
              <Route path="/plans/:id" element={<PlanDetail />} />
              <Route path="/bookings" element={<MyBookings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PlannerProvider>
    </AuthProvider>
  </React.StrictMode>
);
