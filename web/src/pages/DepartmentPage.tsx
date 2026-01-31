import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Spinner, Table } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { DepartmentEmployeeWorkloadRow } from '../lib/types'
import { fmtHoursDays } from '../lib/format'

export function DepartmentPage() {
  
  const { t } = useTranslation();
const { ctx } = useAuth()
  const nav = useNavigate()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<DepartmentEmployeeWorkloadRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  const isManager = ctx?.role === 'manager'

  const fetchData = async () => {
    setLoading(true)
    setErr(null)
    try {
      const q = supabase.from('v_department_employee_workload').select('*').order('open_steps', { ascending: false })
      const { data, error } = ctx?.department_id ? await q.eq('department_id', ctx.department_id) : await q
      if (error) throw error
      setRows((data as DepartmentEmployeeWorkloadRow[]) ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.department_id])

  const totals = useMemo(() => {
    const open = rows.reduce((a, r) => a + (r.open_steps ?? 0), 0)
    const ip = rows.reduce((a, r) => a + (r.in_progress_steps ?? 0), 0)
    return { open, ip }
  }, [rows])

  if (!isManager) {
    return (
      <Alert variant="warning" className="ocp-card p-4">
        This page is intended for Department Managers.
      </Alert>
    )
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>{t('department.title')}</div>
          <div className="ocp-muted">
            Employee workload, time-in-step, and performance visibility (department-scoped).
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => fetchData()} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-2" />{t('department.refresh')}</Button>
          <Button className="rounded-pill" onClick={() => nav('/tasks')}>
            Open requests
          </Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      <div className="d-flex gap-2 flex-wrap mb-3">
        <span className="ocp-pill">
          Total open steps: <span className="fw-semibold">{totals.open}</span>
        </span>
        <span className="ocp-pill">
          In progress: <span className="fw-semibold">{totals.ip}</span>
        </span>
      </div>

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
                    <th>Employee</th>
                    <th>Email</th>
                    <th>Open steps</th>
                    <th>In progress</th>
                    <th>Avg age (hours)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id}>
                      <td>
                        <div className="fw-semibold">{r.full_name}</div>
                        <div className="small ocp-muted">{r.job_title ?? '—'}</div>
                      </td>
                      <td className="small">{r.email}</td>
                      <td className="fw-semibold">{r.open_steps}</td>
                      <td className="fw-semibold">{r.in_progress_steps}</td>
                      <td>{r.avg_step_age_hours == null ? '—' : fmtHoursDays(r.avg_step_age_hours, r.avg_step_age_hours / 24)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">
                        No employees visible (check membership + department assignment).
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
