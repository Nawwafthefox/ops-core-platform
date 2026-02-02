import React, { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/AuthProvider'
import { useSystemAdmin } from '../lib/useSystemAdmin'
import { supabase } from '../lib/supabaseClient'

type Item = {
  to: string
  icon: string
  labelKey: string
  roles?: Array<'admin' | 'ceo' | 'manager' | 'employee'>
  systemOnly?: boolean
}

const items: Item[] = [
  { to: '/', icon: 'bi-speedometer2', labelKey: 'nav.dashboard' },
  { to: '/tasks', icon: 'bi-inbox', labelKey: 'nav.tasks' },
  { to: '/tasks/new', icon: 'bi-plus-circle', labelKey: 'nav.create_request' },
  { to: '/sla', icon: 'bi-stopwatch', labelKey: 'nav.sla', roles: ['manager', 'admin', 'ceo'] },
  { to: '/department', icon: 'bi-people', labelKey: 'nav.department', roles: ['manager'] },
  { to: '/audit', icon: 'bi-shield-check', labelKey: 'nav.audit', roles: ['manager', 'admin', 'ceo'] },
  { to: '/settings/automation', icon: 'bi-sliders', labelKey: 'nav.automation', roles: ['manager', 'admin', 'ceo'] },
  { to: '/admin', icon: 'bi-gear', labelKey: 'nav.admin', roles: ['admin'] },
  { to: '/admin/system', icon: 'bi-shield-lock', labelKey: 'nav.system_admin', systemOnly: true }
]

function SidebarLanguageToggle() {
  const { t, i18n } = useTranslation()
  const isArabic = i18n.language?.startsWith('ar')

  return (
    <div className="mt-3">
      <div className="small ocp-muted mb-2">{t('common.language')}</div>
      <div className="btn-group btn-group-sm w-100" role="group" aria-label={t('common.language')} data-ocp-lang-toggle="1">
        <button
          type="button"
          className={'btn btn-outline-secondary ' + (!isArabic ? 'active' : '')}
          onClick={() => i18n.changeLanguage('en')}
        >
          EN
        </button>
        <button
          type="button"
          className={'btn btn-outline-secondary ' + (isArabic ? 'active' : '')}
          onClick={() => i18n.changeLanguage('ar')}
        >
          AR
        </button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const { isSystemAdmin } = useSystemAdmin()
  const { ctx } = useAuth()

  // Prefer ctx.company_id if present; fallback to any legacy naming
  const companyId = useMemo(() => {
    return ((ctx as any)?.company_id ?? (ctx as any)?.companyId ?? '') as string
  }, [ctx])

  const [companyName, setCompanyName] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!companyId) {
        setCompanyName('')
        return
      }

      const { data, error } = await supabase
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        setCompanyName('')
        return
      }
      setCompanyName((data as any)?.name ?? '')
    }

    run()
    return () => {
      cancelled = true
    }
  }, [companyId])

  return (
    <aside className="ocp-sidebar d-none d-lg-block">
      <div className="ocp-brand">
        <p className="title mb-1">Operations Core Platform</p>

        <p className="subtitle mb-0">
          <span className="fw-semibold">{ctx?.full_name ?? ''}</span>
          <span style={{ opacity: 0.6 }}> • </span>
          <span className="fw-semibold">{companyName || '—'}</span>
          <span style={{ opacity: 0.6 }}> • </span>
          <span className="text-capitalize">{ctx?.role ?? ''}</span>
        </p>
      </div>

      <nav className="ocp-nav d-flex flex-column gap-1">
        {items
          .filter((i) => !i.systemOnly || isSystemAdmin)
          .filter((i) => !i.roles || (ctx && i.roles.includes(ctx.role)))
          .map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                [
                  'ocp-nav-link',
                  'd-flex',
                  'align-items-center',
                  'w-100',
                  'text-decoration-none',
                  'text-nowrap',
                  'px-2',
                  'py-2',
                  isActive ? 'active' : ''
                ].join(' ')
              }
            >
              <i className={`bi ${i.icon} me-2`} style={{ minWidth: 18 }} />
              <span className="flex-grow-1">{t(i.labelKey)}</span>
            </NavLink>
          ))}
      </nav>

      <div className="px-2 pb-3">
        <SidebarLanguageToggle />
      </div>
    </aside>
  )
}
