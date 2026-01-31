import React from 'react'
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route } from 'react-router-dom'

import { applyDocumentLocale } from './lib/locale';
import { AuthProvider } from './lib/AuthProvider'
import { useSystemAdmin } from './lib/useSystemAdmin'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'

import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { TasksListPage } from './pages/TasksListPage'
import { TaskNewPage } from './pages/TaskNewPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { DepartmentPage } from './pages/DepartmentPage'
import { AuditPage } from './pages/AuditPage'
import SlaDashboardPage from './pages/SlaDashboardPage'
import { AutomationPage } from './pages/settings/AutomationPage'
import { AdminConsolePage } from './pages/admin/AdminConsolePage'
import SystemAdminConsolePage from './pages/admin/SystemAdminConsolePage'

function SystemAdminGuard({ children }: { children: React.ReactNode }) {
  const { isSystemAdmin, loading } = useSystemAdmin()
  if (loading) return <div className="container-xxl py-3">Checking permissions...</div>
  if (!isSystemAdmin) return <div className="container-xxl py-3">Forbidden</div>
  return children
}

export default function App() {
  
  const { i18n } = useTranslation();
  useEffect(() => {
    applyDocumentLocale(i18n.language);
  }, [i18n.language]);

return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="tasks" element={<TasksListPage />} />
            <Route path="tasks/new" element={<TaskNewPage />} />
            <Route path="tasks/:id" element={<TaskDetailPage />} />
            <Route path="department" element={<DepartmentPage />} />
            <Route path="sla" element={<SlaDashboardPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings/automation" element={<AutomationPage />} />
            <Route path="admin" element={<AdminConsolePage />} />
            <Route
              path="admin/system"
              element={
                <SystemAdminGuard>
                  <SystemAdminConsolePage />
                </SystemAdminGuard>
              }
            />
          </Route>

          <Route path="*" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
