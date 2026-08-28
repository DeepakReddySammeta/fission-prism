import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="shell">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} />
      <div className={`shell-main${sidebarCollapsed ? ' shell-main-collapsed' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
}
