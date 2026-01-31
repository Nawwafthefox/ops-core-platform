import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Tab, Table, Tabs } from 'react-bootstrap'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthProvider'
import type { DepartmentRow, MembershipRow, ProfileRow, RequestTypeRow } from '../../lib/types'

type UserRow = {
  user_id: string
  full_name: string
  email: string
  role: MembershipRow['role']
  department_id: string | null
  branch_id: string | null
  is_active: boolean
}

export function AdminConsolePage() {
  const { ctx } = useAuth()
  const isAdmin = ctx?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [memberships, setMemberships] = useState<MembershipRow[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [requestTypes, setRequestTypes] = useState<RequestTypeRow[]>([])

  // edit user modal
  const [showUser, setShowUser] = useState(false)
  const [editUserId, setEditUserId] = useState('')
  const [editRole, setEditRole] = useState<MembershipRow['role']>('employee')
  const [editDeptId, setEditDeptId] = useState<string>('')
  const [editName, setEditName] = useState('')

  // request type modal
  const [showRT, setShowRT] = useState(false)
  const [rtId, setRtId] = useState<string>('')
  const [rtName, setRtName] = useState('')
  const [rtDesc, setRtDesc] = useState('')
  const [rtPriority, setRtPriority] = useState<number>(3)
  const [rtActive, setRtActive] = useState(true)

  // outbox stats
  const [outbox, setOutbox] = useState<{ queued: number; processing: number; sent: number; failed: number }>({
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  })

  const users: UserRow[] = useMemo(() => {
    const profById = new Map(profiles.map((p) => [p.user_id, p]))
    return memberships
      .map((m) => {
        const p = profById.get(m.user_id)
        return {
          user_id: m.user_id,
          full_name: p?.full_name ?? m.user_id,
          email: p?.email ?? '—',
          role: m.role,
          department_id: m.department_id,
          branch_id: m.branch_id,
          is_active: p?.is_active ?? true,
        }
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [profiles, memberships])

  const loadAll = async () => {
    if (!ctx?.company_id) return
    setLoading(true)
    setErr(null)
    try {
      const [{ data: p, error: pErr }, { data: m, error: mErr }, { data: d, error: dErr }, { data: rt, error: rtErr }] =
        await Promise.all([
          supabase.from('profiles').select('*').order('full_name'),
          supabase.from('memberships').select('*').eq('company_id', ctx.company_id).order('created_at'),
          supabase.from('departments').select('*').eq('company_id', ctx.company_id).order('name'),
          supabase.from('request_types').select('*').eq('company_id', ctx.company_id).order('name'),
        ])

      if (pErr) throw pErr
      if (mErr) throw mErr
      if (dErr) throw dErr
      if (rtErr) throw rtErr

      setProfiles((p as ProfileRow[]) ?? [])
      setMemberships((m as MembershipRow[]) ?? [])
      setDepartments((d as DepartmentRow[]) ?? [])
      setRequestTypes((rt as RequestTypeRow[]) ?? [])

      // outbox counts
      const { data: ob, error: obErr } = await supabase.from('notification_outbox').select('status', { count: 'exact', head: false })
      // Note: if select returns rows, we count client-side; this is ok for small dev.
      if (!obErr) {
        const c = { queued: 0, processing: 0, sent: 0, failed: 0 }
        ;(ob as any[] | null)?.forEach((r) => {
          const s = String(r.status)
          if (s in c) (c as any)[s] += 1
        })
        setOutbox(c)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.company_id])

  const openUserModal = (u: UserRow) => {
    setEditUserId(u.user_id)
    setEditRole(u.role)
    setEditDeptId(u.department_id ?? '')
    setEditName(u.full_name)
    setShowUser(true)
  }

  const saveUser = async () => {
    if (!ctx?.company_id) return
    setBusy(true)
    setErr(null)
    try {
      const dept = editRole === 'admin' || editRole === 'ceo' ? null : editDeptId || null
      const { error } = await supabase.rpc('rpc_admin_set_user_role', {
        p_company_id: ctx.company_id,
        p_target_user_id: editUserId,
        p_role: editRole,
        p_department_id: dept,
      })
      if (error) throw error
      setShowUser(false)
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openRTModal = (rt?: RequestTypeRow) => {
    setRtId(rt?.id ?? '')
    setRtName(rt?.name ?? '')
    setRtDesc(rt?.description ?? '')
    setRtPriority(rt?.default_priority ?? 3)
    setRtActive(rt?.active ?? true)
    setShowRT(true)
  }

  const saveRT = async () => {
    if (!ctx?.company_id) return
    if (!rtName.trim()) return setErr('Request type name is required.')
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_admin_upsert_request_type', {
        p_company_id: ctx.company_id,
        p_request_type_id: rtId || null,
        p_name: rtName.trim(),
        p_description: rtDesc.trim() || null,
        p_default_priority: rtPriority,
        p_active: rtActive,
      })
      if (error) throw error
      setShowRT(false)
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runOutbox = async () => {
    setBusy(true)
    setErr(null)
    try {
      const base = (import.meta.env.VITE_SUPABASE_URL as string) || ''
      const url = `${base.replace(/\/$/, '')}/functions/v1/send-outbox-emails`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error(`Edge function failed: ${res.status} ${await res.text()}`)
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <Alert variant="warning" className="ocp-card p-4">
        Admin Console is available to <strong>Admin</strong> role only.
      </Alert>
    )
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="fw-semibold" style={{ fontSize: 18 }}>
            Admin Console
          </div>
          <div className="ocp-muted">Manage users, roles, request types, and outbox diagnostics.</div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => loadAll()} disabled={loading || busy}>
            <i className="bi bi-arrow-clockwise me-2" />
            Refresh
          </Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      <Card className="ocp-card">
        <Card.Body>
          <Tabs defaultActiveKey="users" className="mb-3">
            <Tab eventKey="users" title="Users & Roles">
              {loading ? (
                <div className="d-flex justify-content-center py-5">
                  <Spinner animation="border" />
                </div>
              ) : (
                <div className="ocp-table">
                  <Table responsive className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.user_id}>
                          <td>
                            <div className="fw-semibold">{u.full_name}</div>
                            <div className="small ocp-muted ocp-code">{u.user_id}</div>
                          </td>
                          <td className="small">{u.email}</td>
                          <td>
                            <Badge bg="light" text="dark" className="rounded-pill px-3 py-2 border text-capitalize">
                              {u.role}
                            </Badge>
                          </td>
                          <td className="small">
                            {u.department_id ? departments.find((d) => d.id === u.department_id)?.name ?? u.department_id : '—'}
                          </td>
                          <td>
                            <Badge bg={u.is_active ? 'success' : 'secondary'} className="rounded-pill px-3 py-2">
                              {u.is_active ? 'Active' : 'Disabled'}
                            </Badge>
                          </td>
                          <td className="text-end">
                            <Button size="sm" variant="outline-primary" className="rounded-pill" onClick={() => openUserModal(u)} disabled={busy}>
                              Edit
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!users.length && (
                        <tr>
                          <td colSpan={6} className="text-center text-muted py-4">
                            No users.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                </div>
              )}
            </Tab>

            <Tab eventKey="requestTypes" title="Request Types">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="small ocp-muted">
                  Add/modify request types. Managers then set per-department automation rules.
                </div>
                <Button className="rounded-pill" onClick={() => openRTModal()} disabled={busy}>
                  <i className="bi bi-plus-circle me-2" />
                  New type
                </Button>
              </div>

              <div className="ocp-table">
                <Table responsive className="mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Default priority</th>
                      <th>Active</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestTypes.map((rt) => (
                      <tr key={rt.id}>
                        <td style={{ minWidth: 260 }}>
                          <div className="fw-semibold">{rt.name}</div>
                          <div className="small ocp-muted">{rt.description ?? '—'}</div>
                        </td>
                        <td>{rt.default_priority}</td>
                        <td>
                          <Badge bg={rt.active ? 'success' : 'secondary'} className="rounded-pill px-3 py-2">
                            {rt.active ? 'Active' : 'Disabled'}
                          </Badge>
                        </td>
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary" className="rounded-pill" onClick={() => openRTModal(rt)} disabled={busy}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!requestTypes.length && (
                      <tr>
                        <td colSpan={4} className="text-center text-muted py-4">
                          No request types.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Tab>

            <Tab eventKey="outbox" title="Notifications (Outbox)">
              <Row className="g-3">
                <Col md={3}>
                  <Card className="ocp-card">
                    <Card.Body>
                      <div className="small ocp-muted">Queued</div>
                      <div className="display-6 fw-semibold">{outbox.queued}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={3}>
                  <Card className="ocp-card">
                    <Card.Body>
                      <div className="small ocp-muted">Processing</div>
                      <div className="display-6 fw-semibold">{outbox.processing}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={3}>
                  <Card className="ocp-card">
                    <Card.Body>
                      <div className="small ocp-muted">Sent</div>
                      <div className="display-6 fw-semibold">{outbox.sent}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={3}>
                  <Card className="ocp-card">
                    <Card.Body>
                      <div className="small ocp-muted">Failed</div>
                      <div className="display-6 fw-semibold">{outbox.failed}</div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>

              <div className="mt-3 d-flex flex-wrap gap-2 align-items-center">
                <Button className="rounded-pill" onClick={() => runOutbox()} disabled={busy}>
                  <i className="bi bi-envelope me-2" />
                  Run outbox worker (local)
                </Button>
                <span className="small ocp-muted">
                  Make sure you run{' '}
                  <span className="ocp-code">supabase functions serve send-outbox-emails --no-verify-jwt</span>.
                </span>
              </div>
            </Tab>
          </Tabs>
        </Card.Body>
      </Card>

      {/* Edit user modal */}
      <Modal show={showUser} onHide={() => setShowUser(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Edit user</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-2">
            <div className="fw-semibold">{editName}</div>
            <div className="small ocp-muted ocp-code">{editUserId}</div>
          </div>

          <Form.Group className="mb-3">
            <Form.Label>Role</Form.Label>
            <Form.Select value={editRole} onChange={(e) => setEditRole(e.target.value as any)} disabled={busy}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="ceo">CEO</option>
              <option value="admin">Admin</option>
            </Form.Select>
            <div className="small ocp-muted mt-2">
              CEO sees everything but cannot perform Admin-only actions like role changes or rollbacks.
            </div>
          </Form.Group>

          <Form.Group>
            <Form.Label>Department</Form.Label>
            <Form.Select
              value={editDeptId}
              onChange={(e) => setEditDeptId(e.target.value)}
              disabled={busy || editRole === 'admin' || editRole === 'ceo'}
            >
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Form.Select>
            <div className="small ocp-muted mt-2">
              Required for Manager/Employee. Admin/CEO are cross-department by design.
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowUser(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="rounded-pill" onClick={() => saveUser()} disabled={busy}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Request type modal */}
      <Modal show={showRT} onHide={() => setShowRT(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{rtId ? 'Edit request type' : 'New request type'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control value={rtName} onChange={(e) => setRtName(e.target.value)} disabled={busy} />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description</Form.Label>
            <Form.Control as="textarea" rows={3} value={rtDesc} onChange={(e) => setRtDesc(e.target.value)} disabled={busy} />
          </Form.Group>

          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Default priority</Form.Label>
                <Form.Select value={rtPriority} onChange={(e) => setRtPriority(Number(e.target.value))} disabled={busy}>
                  <option value={1}>Low</option>
                  <option value={2}>Medium</option>
                  <option value={3}>High</option>
                  <option value={4}>Critical</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Active</Form.Label>
                <Form.Check
                  type="switch"
                  checked={rtActive}
                  onChange={(e) => setRtActive(e.target.checked)}
                  disabled={busy}
                />
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowRT(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="rounded-pill" onClick={() => saveRT()} disabled={busy}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
