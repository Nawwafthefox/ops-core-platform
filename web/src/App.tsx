import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'

import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { TasksListPage } from './pages/TasksListPage'
import { TaskNewPage } from './pages/TaskNewPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { DepartmentPage } from './pages/DepartmentPage'
import { AuditPage } from './pages/AuditPage'
import { AutomationPage } from './pages/settings/AutomationPage'
import { AdminConsolePage } from './pages/admin/AdminConsolePage'

export default function App() {
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
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings/automation" element={<AutomationPage />} />
            <Route path="admin" element={<AdminConsolePage />} />
          </Route>

          <Route path="*" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
