import React, { useState } from 'react'
import { Container, Offcanvas, Button } from 'react-bootstrap'
import { Outlet, NavLink } from 'react-router-dom'
import { useEnforceActiveUser } from '../lib/useEnforceActiveUser'
import { useTranslation } from 'react-i18next';
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuth } from '../lib/AuthProvider'

type Item = {
  to: string
  icon: string
  label: string
  roles?: Array<'admin' | 'ceo' | 'manager' | 'employee'>
}

const items: Item[] = [
  { to: '/', icon: 'bi-speedometer2', label: 'Dashboard' },
  { to: '/tasks', icon: 'bi-inbox', label: 'Requests / Tasks' },
  { to: '/tasks/new', icon: 'bi-plus-circle', label: 'Create Request' },
  { to: '/department', icon: 'bi-people', label: 'My Department', roles: ['manager'] },
  { to: '/audit', icon: 'bi-shield-check', label: 'Audit Logs', roles: ['manager', 'admin', 'ceo'] },
  { to: '/settings/automation', icon: 'bi-sliders', label: 'Automation', roles: ['manager', 'admin', 'ceo'] },
  { to: '/admin', icon: 'bi-gear', label: 'Admin Console', roles: ['admin'] },
]

export function AppLayout() {
  useEnforceActiveUser();
  const [show, setShow] = useState(false)
  const { ctx } = useAuth()

  return (
    <div className="ocp-shell">
      <Sidebar />

      {/* Mobile sidebar */}
      <Offcanvas show={show} onHide={() => setShow(false)} responsive="lg">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Operations Core</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="d-flex flex-column gap-1">
            {items
              .filter((i) => !i.roles || (ctx && i.roles.includes(ctx.role)))
              .map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? 'active' : ''}`.trim()
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 12,
                    color: '#0f172a',
                  }}
                  onClick={() => setShow(false)}
                  end={i.to === '/'}
                >
                  <span className={`nav-icon bi ${i.icon}`} />
                  <span>{i.label}</span>
                </NavLink>
              ))}
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      <div className="ocp-content">
        <div className="d-lg-none px-3 pt-3">
          <Container fluid className="d-flex align-items-center justify-content-between">
            <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShow(true)}>
              <i className="bi bi-list" /> Menu
            </Button>
            <div className="small text-muted text-truncate">{ctx?.full_name}</div>
          </Container>
        </div>

        <Topbar />
        <main className="ocp-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
