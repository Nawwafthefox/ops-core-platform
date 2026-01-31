import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { AuditLogRow } from '../lib/types'
import { fmtDateTime } from '../lib/format'

type TableFilter = 'all' | 'requests' | 'request_steps' | 'request_comments' | 'memberships'

export function AuditPage() {
  
  const { t } = useTranslation();
const { ctx } = useAuth()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [tableFilter, setTableFilter] = useState<TableFilter>('all')

  const isAdmin = ctx?.role === 'admin'

  const fetchData = async () => {
    setLoading(true)
    setErr(null)
    try {
      let q = supabase.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(200)
      if (tableFilter !== 'all') q = q.eq('table_name', tableFilter)
      const { data, error } = await q
      if (error) throw error
      setRows((data as AuditLogRow[]) ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter])

  const rollback = async (auditId: number) => {
    if (!isAdmin) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_admin_rollback_audit', { p_audit_log_id: auditId })
      if (error) throw error
      await fetchData()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const filteredRows = useMemo(() => rows, [rows])

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            Audit logs
          </div>
          <div className="ocp-muted">
            Best-practice audit trail (immutable log). Managers see only accessible requests. Admin/CEO see everything.
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => fetchData()} disabled={loading || busy}>
            <i className="bi bi-arrow-clockwise me-2" />{t('audit.refresh')}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      <Card className="ocp-card mb-3">
        <Card.Body className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
          <div className="d-flex gap-2 align-items-center">
            <Form.Select value={tableFilter} onChange={(e) => setTableFilter(e.target.value as TableFilter)} style={{ width: 260 }}>
              <option value="all">All tables</option>
              <option value="requests">requests</option>
              <option value="request_steps">request_steps</option>
              <option value="request_comments">request_comments</option>
              <option value="memberships">memberships</option>
            </Form.Select>
            {busy && (
              <span className="small ocp-muted d-flex align-items-center gap-2">
                <Spinner size="sm" animation="border" /> Working…
              </span>
            )}
          </div>

          <div className="small ocp-muted">
            Showing <span className="fw-semibold">{filteredRows.length}</span> records
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
                    <th>When</th>
                    <th>Action</th>
                    <th>Table</th>
                    <th>Record</th>
                    <th>Request</th>
                    <th>User</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{fmtDateTime(r.changed_at)}</td>
                      <td className="fw-semibold">{r.action}</td>
                      <td>{r.table_name}</td>
                      <td className="small ocp-code">{r.record_pk}</td>
                      <td className="small ocp-code">{r.request_id ?? '—'}</td>
                      <td className="small ocp-code">{r.changed_by ? r.changed_by.slice(0, 8) : '—'}</td>
                      <td className="text-end">
                        {isAdmin && r.table_name === 'requests' && r.action === 'UPDATE' && (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            className="rounded-pill"
                            onClick={() => rollback(r.id)}
                            disabled={busy}
                          >{t('audit.rollback')}</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filteredRows.length && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-4">
                        No audit rows visible.
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
