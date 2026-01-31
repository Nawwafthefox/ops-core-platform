import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthProvider'
import type { DepartmentRow, RequestTypeRow } from '../../lib/types'

type DeptRTSetting = {
  company_id: string
  department_id: string
  request_type_id: string
  approval_mode: 'manual' | 'auto'
  auto_close: boolean
  default_next_department_id: string | null
}

export function AutomationPage() {
  const { ctx } = useAuth()

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [requestTypes, setRequestTypes] = useState<RequestTypeRow[]>([])
  const [settings, setSettings] = useState<DeptRTSetting[]>([])

  const isManager = ctx?.role === 'manager'
  const isAdminish = ctx?.role === 'admin' || ctx?.role === 'ceo'

  const [selectedDeptId, setSelectedDeptId] = useState<string>('')

  const activeDeptId = useMemo(() => {
    if (!ctx) return ''
    if (isManager) return ctx.department_id ?? ''
    return selectedDeptId
  }, [ctx, isManager, selectedDeptId])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const [{ data: depts, error: dErr }, { data: rts, error: rtErr }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('request_types').select('*').eq('active', true).order('name'),
      ])
      if (dErr) throw dErr
      if (rtErr) throw rtErr

      setDepartments((depts as DepartmentRow[]) ?? [])
      setRequestTypes((rts as RequestTypeRow[]) ?? [])

      if (!isManager && !selectedDeptId && depts && depts.length) {
        setSelectedDeptId((depts[0] as DepartmentRow).id)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadSettings = async (deptId: string) => {
    if (!deptId) return
    const { data, error } = await supabase
      .from('department_request_type_settings')
      .select('*')
      .eq('department_id', deptId)

    if (error) {
      setErr(error.message)
      return
    }
    setSettings((data as DeptRTSetting[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeDeptId) return
    loadSettings(activeDeptId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDeptId])

  const getSetting = (requestTypeId: string): DeptRTSetting | null => {
    return settings.find((s) => s.request_type_id === requestTypeId) ?? null
  }

  const upsertLocal = (requestTypeId: string, patch: Partial<DeptRTSetting>) => {
    setSettings((prev) => {
      const existing = prev.find((s) => s.request_type_id === requestTypeId)
      if (existing) {
        return prev.map((s) => (s.request_type_id === requestTypeId ? { ...s, ...patch } : s))
      }
      if (!ctx?.company_id || !activeDeptId) return prev
      return [
        ...prev,
        {
          company_id: ctx.company_id,
          department_id: activeDeptId,
          request_type_id: requestTypeId,
          approval_mode: 'manual',
          auto_close: true,
          default_next_department_id: null,
          ...patch,
        } as DeptRTSetting,
      ]
    })
  }

  const save = async (rtId: string) => {
    if (!ctx?.company_id) return
    if (!activeDeptId) return
    const s = getSetting(rtId)
    const payload = {
      p_company_id: ctx.company_id,
      p_department_id: activeDeptId,
      p_request_type_id: rtId,
      p_approval_mode: (s?.approval_mode ?? 'manual') as 'manual' | 'auto',
      p_auto_close: s?.auto_close ?? true,
      p_default_next_department_id: s?.default_next_department_id ?? null,
    }

    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_set_department_request_type_setting', payload)
      if (error) throw error
      await loadSettings(activeDeptId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isManager && !isAdminish) {
    return (
      <Alert variant="warning" className="ocp-card p-4">
        This page is available to Managers, CEO, and Admin.
      </Alert>
    )
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            Automation rules
          </div>
          <div className="ocp-muted">
            Configure per-department auto-approval for routine tasks + default routing.
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => activeDeptId && loadSettings(activeDeptId)} disabled={busy}>
            <i className="bi bi-arrow-clockwise me-2" />
            Refresh
          </Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      <Card className="ocp-card mb-3">
        <Card.Body className="d-flex flex-wrap gap-3 align-items-center justify-content-between">
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <span className="ocp-pill">
              Rule scope: <span className="fw-semibold">{isManager ? 'My department' : 'Selected department'}</span>
            </span>

            {!isManager && (
              <Form.Select value={selectedDeptId} onChange={(e) => setSelectedDeptId(e.target.value)} style={{ width: 260 }}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Form.Select>
            )}
          </div>

          {busy && (
            <span className="small ocp-muted d-flex align-items-center gap-2">
              <Spinner size="sm" animation="border" /> Saving…
            </span>
          )}
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
                    <th>Request type</th>
                    <th>Approval</th>
                    <th>Auto close</th>
                    <th>Default next dept</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requestTypes.map((rt) => {
                    const s = getSetting(rt.id)
                    return (
                      <tr key={rt.id}>
                        <td style={{ minWidth: 260 }}>
                          <div className="fw-semibold">{rt.name}</div>
                          <div className="small ocp-muted">{rt.description ?? '—'}</div>
                        </td>
                        <td style={{ width: 180 }}>
                          <Form.Select
                            value={s?.approval_mode ?? 'manual'}
                            onChange={(e) => upsertLocal(rt.id, { approval_mode: e.target.value as 'manual' | 'auto' })}
                          >
                            <option value="manual">Manual</option>
                            <option value="auto">Auto</option>
                          </Form.Select>
                        </td>
                        <td style={{ width: 140 }}>
                          <Form.Check
                            type="switch"
                            checked={s?.auto_close ?? true}
                            onChange={(e) => upsertLocal(rt.id, { auto_close: e.target.checked })}
                          />
                        </td>
                        <td style={{ width: 260 }}>
                          <Form.Select
                            value={s?.default_next_department_id ?? ''}
                            onChange={(e) => upsertLocal(rt.id, { default_next_department_id: e.target.value || null })}
                          >
                            <option value="">None</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </Form.Select>
                        </td>
                        <td className="text-end" style={{ width: 120 }}>
                          <Button variant="outline-primary" className="rounded-pill" size="sm" onClick={() => save(rt.id)} disabled={busy}>
                            Save
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {!requestTypes.length && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">
                        No request types found.
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
