import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';

export function AppShell() {
  // Header spans the full width above the sidebar+content row, so Prism reads
  // as one workspace rather than as a second nav column competing with the
  // portal's own rail to its left.
  return (
    <div className="shell-root">
      <AppHeader />
      <div className="shell">
        <Sidebar />
        <div className="shell-main">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
