import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Outlet />
      </div>
    </div>
  );
}
