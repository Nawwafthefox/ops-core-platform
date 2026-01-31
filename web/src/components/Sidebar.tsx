import React from 'react'
import { NavLink } from 'react-router-dom'
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

export function Sidebar() {
  const { ctx } = useAuth()

  return (
    <aside className="ocp-sidebar d-none d-lg-block">
      <div className="ocp-brand">
        <p className="title mb-1">Operations Core Platform</p>
        <p className="subtitle">
          {ctx?.full_name} <span style={{ opacity: 0.6 }}>•</span>{' '}
          <span className="text-capitalize">{ctx?.role}</span>
        </p>
      </div>

      <nav className="ocp-nav">
        {items
          .filter((i) => !i.roles || (ctx && i.roles.includes(ctx.role)))
          .map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              end={i.to === '/'}
            >
              <span className={`nav-icon bi ${i.icon}`} />
              <span>{i.label}</span>
            </NavLink>
          ))}
      </nav>

      <div className="px-3 pb-3" style={{ position: 'absolute', bottom: 0, width: '100%' }}>
        <div
          className="p-3"
          style={{
            borderRadius: 14,
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.08)',
          }}
        >
          <div className="small" style={{ opacity: 0.8 }}>
            Tenant
          </div>
          <div className="fw-semibold small text-truncate">{ctx?.company_id}</div>
        </div>
      </div>
    </aside>
  )
}
