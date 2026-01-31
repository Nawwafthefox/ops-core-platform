import React from 'react'
import { Container, Dropdown } from 'react-bootstrap'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/AuthProvider'

function titleFromPath(pathname: string) {
  if (pathname === '/') return 'Dashboard'
  if (pathname.startsWith('/tasks/new')) return 'Create Request'
  if (pathname.startsWith('/tasks/')) return 'Request Details'
  if (pathname.startsWith('/tasks')) return 'Requests / Tasks'
  if (pathname.startsWith('/department')) return 'My Department'
  if (pathname.startsWith('/audit')) return 'Audit Logs'
  if (pathname.startsWith('/settings/automation')) return 'Automation'
  if (pathname.startsWith('/admin')) return 'Admin Console'
  return 'Operations Core'
}

export function Topbar() {
  
  const { t, i18n } = useTranslation();
const { ctx, signOut } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()

  return (
    <div className="ocp-topbar py-3">
      <Container fluid className="px-4 d-flex align-items-center justify-content-between">
        <div className="d-flex align-items-center gap-3">
          <div>
            <div className="fw-semibold" style={{ letterSpacing: 0.2 }}>
              {titleFromPath(loc.pathname)}
            </div>
            <div className="small ocp-muted">
              {ctx?.role === 'manager' ? 'Department visibility + approvals' : 'Requests, workflows, KPIs'}
            </div>
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Dropdown align="end">
            <Dropdown.Toggle variant="outline-secondary" className="rounded-pill px-3">
              <i className="bi bi-person-circle me-2" />
              {ctx?.full_name ?? 'User'}
            </Dropdown.Toggle>
            <Dropdown.Menu className="shadow-sm">
              <Dropdown.Header>
                <div className="fw-semibold">{ctx?.full_name}</div>
                <div className="small text-muted">{ctx?.email}</div>
                <div className="small text-muted text-capitalize">{ctx?.role}</div>
              </Dropdown.Header>
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => nav('/tasks')}>My tasks</Dropdown.Item>
              <Dropdown.Item onClick={() => nav('/settings/automation')}>Automation</Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item
                onClick={() => signOut().then(() => nav('/login'))}
                className="text-danger"
              >
                <i className="bi bi-box-arrow-right me-2" />
                Sign out
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </Container>
    </div>
  )
}
