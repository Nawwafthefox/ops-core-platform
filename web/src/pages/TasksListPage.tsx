import React, { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Form, InputGroup, Spinner, Table } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { RequestCurrentRow } from '../lib/types'
import { fmtHoursDays, fmtDateTime, priorityLabel } from '../lib/format'
import { RequestStatusBadge, StepStatusBadge } from '../components/StatusBadge'

type Scope = 'visible' | 'mine' | 'my_dept' | 'needs_approval'

export function TasksListPage() {
  const nav = useNavigate()
  const { ctx } = useAuth()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<RequestCurrentRow[]>([])

  const [scope, setScope] = useState<Scope>('visible')
  const [q, setQ] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const base = supabase.from('v_requests_current').select('*').order('updated_at', { ascending: false }).limit(500)
      const { data, error } = showClosed ? await base : await base.eq('request_status', 'open')
      if (error) throw error
      setRows((data as RequestCurrentRow[]) ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClosed, ctx?.user_id])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()

    return rows
      .filter((r) => {
        if (scope === 'mine') return r.current_assignee_id === ctx?.user_id
        if (scope === 'my_dept') return !!ctx?.department_id && r.current_department_id === ctx.department_id
        if (scope === 'needs_approval') {
          if (!r.current_step_status) return false
          if (r.current_step_status !== 'done_pending_approval') return false
          if (ctx?.role === 'admin' || ctx?.role === 'ceo') return true
          return !!ctx?.department_id && r.current_department_id === ctx.department_id
        }
        return true
      })
      .filter((r) => {
        if (!needle) return true
        return (
          r.reference_code.toLowerCase().includes(needle) ||
          r.title.toLowerCase().includes(needle) ||
          (r.current_department_name ?? '').toLowerCase().includes(needle) ||
          (r.current_assignee_name ?? '').toLowerCase().includes(needle)
        )
      })
  }, [rows, q, scope, ctx?.user_id, ctx?.department_id, ctx?.role])

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            {t('tasks.title')}
          </div>
          <div className="ocp-muted">{t('tasks.subtitle')}</div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => fetchData()} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-2" />
            {t('tasks.refresh')}
          </Button>
          <Button className="rounded-pill" onClick={() => nav('/tasks/new')}>
            <i className="bi bi-plus-circle me-2" />
            {t('tasks.create')}
          </Button>
        </div>
      </div>

      <Card className="ocp-card mb-3">
        <Card.Body className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <InputGroup style={{ minWidth: 320 }}>
              <InputGroup.Text>
                <i className="bi bi-search" />
              </InputGroup.Text>
              <Form.Control
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('tasks.search_placeholder')}
              />
            </InputGroup>

            <Form.Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} style={{ width: 220 }}>
              <option value="visible">{t('tasks.scope_visible')}</option>
              <option value="mine">{t('tasks.scope_mine')}</option>
              <option value="my_dept">{t('tasks.scope_my_dept')}</option>
              <option value="needs_approval">{t('tasks.scope_needs_approval')}</option>
            </Form.Select>

            <Form.Check
              type="switch"
              id="showClosed"
              label={t('tasks.include_closed')}
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
          </div>

          <div className="small ocp-muted">
            {t('tasks.showing_records', { count: filtered.length })}{' '}
            <span className="fw-semibold">{filtered.length}</span>
          </div>
        </Card.Body>
      </Card>

      <Card className="ocp-card">
        <Card.Body>
          {loading ? (
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" />
            </div>
          ) : (
            <div className="ocp-table">
              <Table responsive className="mb-0 align-middle">
                <thead>
                  <tr>
                    <th>{t('tasks.th_ref')}</th>
                    <th>{t('tasks.th_title')}</th>
                    <th>{t('tasks.th_type')}</th>
                    <th>{t('tasks.th_priority')}</th>
                    <th>{t('tasks.th_current_dept')}</th>
                    <th>{t('tasks.th_assignee')}</th>
                    <th>{t('tasks.th_status')}</th>
                    <th>{t('tasks.th_age')}</th>
                    <th>{t('tasks.th_sla_due')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/tasks/${r.id}`)}>
                      <td className="fw-semibold">{r.reference_code}</td>
                      <td style={{ minWidth: 260 }}>
                        <div className="fw-semibold">{r.title}</div>
                        <div className="small ocp-muted">
                          {t('tasks.requested_by')} {r.requester_name ?? t('tasks.none')} • {r.origin_department_name ?? t('tasks.none')}
                        </div>
                      </td>
                      <td>{r.request_type_name ?? t('tasks.none')}</td>
                      <td>
                        <Badge bg="light" text="dark" className="rounded-pill px-3 py-2 border">
                          {priorityLabel(r.priority)}
                        </Badge>
                      </td>
                      <td>{r.current_department_name ?? t('tasks.none')}</td>
                      <td>{r.current_assignee_name ?? t('tasks.unassigned')}</td>
                      <td className="d-flex gap-2 align-items-center">
                        <RequestStatusBadge status={r.request_status} />
                        <StepStatusBadge status={r.current_step_status} />
                      </td>
                      <td>{fmtHoursDays(r.current_step_age_hours, r.current_step_age_days)}</td>
                      <td>
                        <div className={r.current_step_is_overdue ? 'text-danger fw-semibold' : undefined}>
                          {fmtDateTime(r.current_step_due_at ?? r.due_at)}
                        </div>
                        {r.current_step_due_at && r.current_step_hours_to_due !== null && r.current_step_hours_to_due !== undefined && (
                          <div className={r.current_step_is_overdue ? 'small text-danger' : 'small ocp-muted'}>
                            {r.current_step_is_overdue ? t('tasks.overdue') : t('tasks.due')}{' '}
                            {t('tasks.due_in')}{' '}
                            {fmtHoursDays(r.current_step_hours_to_due, r.current_step_hours_to_due / 24)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={9} className="text-center text-muted py-4">
                        {t('tasks.no_match')}
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
