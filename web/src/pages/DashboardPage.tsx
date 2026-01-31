import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Row, Spinner, Table } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { RequestCurrentRow } from '../lib/types'
import { fmtHoursDays } from '../lib/format'
import { RequestStatusBadge, StepStatusBadge } from '../components/StatusBadge'

type Kpi = {
  myOpen: number
  pendingApproval: number
  overdue: number
  avgAgeHours: number | null
}

export function DashboardPage() {
  const { ctx } = useAuth()
  const nav = useNavigate()

  const { t } = useTranslation();

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<RequestCurrentRow[]>([])
  const [kpi, setKpi] = useState<Kpi>({ myOpen: 0, pendingApproval: 0, overdue: 0, avgAgeHours: null })

  const isManager = ctx?.role === 'manager'
  const isAdminish = ctx?.role === 'admin' || ctx?.role === 'ceo'

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('v_requests_current')
        .select('*')
        .eq('request_status', 'open')
        .order('updated_at', { ascending: false })
        .limit(200)

      if (error) throw error
      const list = (data as RequestCurrentRow[]) ?? []
      setRows(list)

      const now = new Date()
      const nowIso = now.toISOString()

      const myOpen = list.filter((r) => r.current_assignee_id === ctx?.user_id).length

      const pendingApproval = list.filter((r) => {
        if (!r.current_step_status) return false
        if (r.current_step_status !== 'done_pending_approval') return false
        if (isAdminish) return true
        if (isManager && ctx?.department_id) return r.current_department_id === ctx.department_id
        return false
      }).length

      const overdue = list.filter((r) => r.due_at && r.due_at < nowIso && r.request_status === 'open').length

      const ageVals = list
        .map((r) => r.request_age_hours)
        .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n))
      const avgAgeHours = ageVals.length ? ageVals.reduce((a, b) => a + b, 0) / ageVals.length : null

      setKpi({ myOpen, pendingApproval, overdue, avgAgeHours })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.user_id])

  const top = useMemo(() => rows.slice(0, 8), [rows])

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            {t('dashboard.welcome', { name: ctx?.full_name ?? '' })}
          </div>
          <div className="ocp-muted">
            {t('dashboard.subtitle')}
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => fetchData()} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-2" />
            Refresh
          </Button>
          <Button className="rounded-pill" onClick={() => nav('/tasks/new')}>
            <i className="bi bi-plus-circle me-2" />
            Create request
          </Button>
        </div>
      </div>

      <div className="ocp-kpi mb-4">
        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{t('dashboard.my_open_tasks')}</div>
            <div className="display-6 fw-semibold">{kpi.myOpen}</div>
            <div className="small ocp-muted">{t('dashboard.assigned_to_you')}</div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{t('dashboard.pending_approvals')}</div>
            <div className="display-6 fw-semibold">{kpi.pendingApproval}</div>
            <div className="small ocp-muted">{isManager ? t('dashboard.in_your_department') : t('dashboard.company_wide')}</div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{t('dashboard.overdue')}</div>
            <div className="display-6 fw-semibold">{kpi.overdue}</div>
            <div className="small ocp-muted">{t('dashboard.past_due_date')}</div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{t('dashboard.avg_age')}</div>
            <div className="display-6 fw-semibold">
              {kpi.avgAgeHours == null ? '—' : `${kpi.avgAgeHours.toFixed(1)} h`}
            </div>
            <div className="small ocp-muted">{t('dashboard.open_requests')}</div>
          </Card.Body>
        </Card>
      </div>

      <Card className="ocp-card">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <div className="fw-semibold">{t('dashboard.latest_active_requests')}</div>
              <div className="small ocp-muted">{t('dashboard.most_recently_updated')}</div>
            </div>
            <Button variant="outline-primary" className="rounded-pill" onClick={() => nav('/tasks')}>
              View all
            </Button>
          </div>

          {loading ? (
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" />
            </div>
          ) : (
            <div className="ocp-table">
              <Table responsive className="mb-0 align-middle">
                <thead>
                  <tr>
                    <th>{t('dashboard.ref')}</th>
                    <th>{t('dashboard.title')}</th>
                    <th>{t('dashboard.current_dept')}</th>
                    <th>{t('dashboard.assignee')}</th>
                    <th>{t('dashboard.status')}</th>
                    <th>{t('dashboard.age')}</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr
                      key={r.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => nav(`/tasks/${r.id}`)}
                    >
                      <td className="fw-semibold">{r.reference_code}</td>
                      <td>{r.title}</td>
                      <td>{r.current_department_name ?? t('dashboard.no_dept')}</td>
                      <td>{r.current_assignee_name ?? t('dashboard.unassigned')}</td>
                      <td className="d-flex gap-2 align-items-center">
                        <RequestStatusBadge status={r.request_status} />
                        <StepStatusBadge status={r.current_step_status} />
                      </td>
                      <td>{fmtHoursDays(r.current_step_age_hours, r.current_step_age_days)}</td>
                    </tr>
                  ))}
                  {!top.length && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        {t('dashboard.no_open_requests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
