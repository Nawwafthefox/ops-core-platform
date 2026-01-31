import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/AuthProvider'
import { fmtDateTime, fmtHoursDays } from '../lib/format'
import { supabase } from '../lib/supabaseClient'
import type { SlaOpenStepRow } from '../lib/types'

export default function SlaDashboardPage() {
  const { ctx } = useAuth()

  const companyId = (ctx as any)?.company_id ?? (ctx as any)?.companyId ?? null;
  const [rows, setRows] = useState<SlaOpenStepRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [departmentId, setDepartmentId] = useState<string>('')
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false)

  const load = async () => {
    if (!companyId) return
    setLoading(true)
    setErr(null)
    try {
      const { data, error } = await supabase
        .from('v_sla_open_steps')
        .select('*')
        .eq('company_id', companyId)
        .order('is_overdue', { ascending: false })
        .order('hours_to_due', { ascending: true })

      if (error) throw error

      setRows((data as any as SlaOpenStepRow[]) ?? [])
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load SLA data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const departmentOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.department_id, r.department_name)
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (departmentId && r.department_id !== departmentId) return false
      if (overdueOnly && !r.is_overdue) return false
      return true
    })
  }, [rows, departmentId, overdueOnly])

  const overdueCount = useMemo(() => rows.filter((r) => r.is_overdue).length, [rows])

  return (
    <div className="ocp-page">
      <Row className="g-3">
        <Col md={12}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <h2 className="m-0">SLA dashboard</h2>
              <div className="text-muted">Monitor open steps by due time and overdue breaches.</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg={overdueCount > 0 ? 'danger' : 'success'} pill>
                Overdue: {overdueCount}
              </Badge>
              <Badge bg="secondary" pill>
                Open steps: {rows.length}
              </Badge>
            </div>
          </div>
        </Col>

        <Col md={12}>
          {err && (
            <Alert variant="danger" className="mb-3">
              {err}
            </Alert>
          )}

          <Card>
            <Card.Body>
              <Row className="g-2 align-items-end">
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Department</Form.Label>
                    <Form.Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                      <option value="">All departments</option>
                      {departmentOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Filter</Form.Label>
                    <Form.Check
                      type="switch"
                      id="overdueOnly"
                      label="Overdue only"
                      checked={overdueOnly}
                      onChange={(e) => setOverdueOnly(e.target.checked)}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <div className="text-muted small">Tip: sort is Overdue first, then nearest due time.</div>
                </Col>
              </Row>

              <div className="mt-3">
                {loading ? (
                  <div className="d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" />
                    <span>Loading…</span>
                  </div>
                ) : (
                  <Table responsive hover className="mb-0">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Type</th>
                        <th>Department</th>
                        <th>Assignee</th>
                        <th>Status</th>
                        <th>Due</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.step_id}>
                          <td>
                            <Link to={`/tasks/${r.request_id}`}>{r.reference_code}</Link>
                            <div className="small text-muted">{r.title}</div>
                          </td>
                          <td>{r.request_type_name ?? '—'}</td>
                          <td>{r.department_name}</td>
                          <td>{r.assignee_name ?? 'Unassigned'}</td>
                          <td>
                            <Badge bg={r.is_overdue ? 'danger' : 'secondary'}>{r.status}</Badge>
                          </td>
                          <td>{fmtDateTime(r.due_at)}</td>
                          <td>
                            <div className={r.is_overdue ? 'text-danger fw-semibold' : ''}>
                              {fmtHoursDays(Math.abs(r.hours_to_due), Math.abs(r.hours_to_due / 24))}
                              {r.is_overdue ? ' overdue' : ' left'}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={7} className="text-center text-muted">
                            No rows match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
