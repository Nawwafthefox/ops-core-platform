import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Table, Badge } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { RequestCurrentRow } from '../lib/types'
import { fmtHoursDays } from '../lib/format'
import { RequestStatusBadge, StepStatusBadge } from '../components/StatusBadge'

type KpiRow = {
  scope: 'personal' | 'department' | 'company'
  company_id: string
  department_id: string | null
  active_tasks: number
  overdue_tasks: number
  pending_approval: number
  unassigned_tasks: number
  on_hold: number
  info_required: number
  avg_open_age_hours: number | null
  avg_cycle_time_hours_30d: number | null
  completed_steps_week: number
  approved_steps_week: number
}

export function DashboardPage() {
  const { ctx } = useAuth()
  const nav = useNavigate()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<RequestCurrentRow[]>([])
  const [kpi, setKpi] = useState<KpiRow | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [{ data: list, error: listErr }, { data: kpiData, error: kpiErr }] = await Promise.all([
        supabase
          .from('v_requests_current')
          .select('*')
          .eq('request_status', 'open')
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase.rpc('rpc_dashboard_kpis')
      ])

      if (listErr) throw listErr
      if (kpiErr) throw kpiErr

      setRows((list as RequestCurrentRow[]) ?? [])
      setKpi(((kpiData as any[])?.[0] ?? null) as KpiRow | null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.user_id])

  const top = useMemo(() => rows.slice(0, 8), [rows])

  const scopeLabel =
    kpi?.scope === 'department' ? 'Department' : kpi?.scope === 'company' ? 'Company' : 'My'

  const doneThisWeek =
    kpi?.scope === 'personal'
      ? (kpi?.completed_steps_week ?? 0)
      : (kpi?.approved_steps_week ?? 0)

  const avgTime =
    kpi?.avg_cycle_time_hours_30d == null
      ? '—'
      : `${Number(kpi.avg_cycle_time_hours_30d).toFixed(1)} h`

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            Welcome, {ctx?.full_name}
          </div>
          <div className="ocp-muted">
            {scopeLabel} KPIs • approvals • SLA • workload
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => void fetchData()} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-2" />
            Refresh
          </Button>
          <Button className="rounded-pill" onClick={() => nav('/tasks/new')}>
            <i className="bi bi-plus-circle me-2" />
            Create request
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="ocp-kpi mb-3">
        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{scopeLabel} active tasks</div>
            <div className="display-6 fw-semibold">{kpi?.active_tasks ?? 0}</div>
            <div className="small ocp-muted">Current step workload</div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{scopeLabel} overdue</div>
            <div className="display-6 fw-semibold">{kpi?.overdue_tasks ?? 0}</div>
            <div className="small ocp-muted">Past due date</div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{scopeLabel} done this week</div>
            <div className="display-6 fw-semibold">{doneThisWeek}</div>
            <div className="small ocp-muted">
              {kpi?.scope === 'personal' ? 'Completed by you' : 'Approved/forwarded'}
            </div>
          </Card.Body>
        </Card>

        <Card className="ocp-card kpi-card">
          <Card.Body>
            <div className="ocp-muted small">{scopeLabel} avg task time</div>
            <div className="display-6 fw-semibold">{avgTime}</div>
            <div className="small ocp-muted">Completed steps (last 30d)</div>
          </Card.Body>
        </Card>
      </div>

      {/* Extra management KPIs (actionable) */}
      {kpi && (
        <div className="d-flex flex-wrap gap-2 mb-4">
          <Badge bg="light" text="dark" className="border rounded-pill px-3 py-2">
            Pending approvals: <b>{kpi.pending_approval}</b>
          </Badge>
          <Badge bg="light" text="dark" className="border rounded-pill px-3 py-2">
            Unassigned: <b>{kpi.unassigned_tasks}</b>
          </Badge>
          <Badge bg="light" text="dark" className="border rounded-pill px-3 py-2">
            On hold: <b>{kpi.on_hold}</b>
          </Badge>
          <Badge bg="light" text="dark" className="border rounded-pill px-3 py-2">
            Info required: <b>{kpi.info_required}</b>
          </Badge>
          <Badge bg="light" text="dark" className="border rounded-pill px-3 py-2">
            Avg open age: <b>{kpi.avg_open_age_hours == null ? '—' : `${kpi.avg_open_age_hours.toFixed(1)} h`}</b>
          </Badge>
        </div>
      )}

      {/* List */}
      <Card className="ocp-card">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <div className="fw-semibold">Latest active requests</div>
              <div className="small ocp-muted">Most recently updated (visibility rules apply)</div>
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
                    <th>Ref</th>
                    <th>Title</th>
                    <th>Current dept</th>
                    <th>Assignee</th>
                    <th>Status</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/tasks/${r.id}`)}>
                      <td className="fw-semibold">{r.reference_code}</td>
                      <td>{r.title}</td>
                      <td>{r.current_department_name ?? '—'}</td>
                      <td>{r.current_assignee_name ?? 'Unassigned'}</td>
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
                        No open requests visible to you yet.
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
