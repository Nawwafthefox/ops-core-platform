import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { supabase } from '../../lib/supabaseClient'

type Company = { id: string; name: string; created_at?: string }
type Department = { id: string; name: string }
type RoleType = 'employee' | 'manager' | 'admin' | 'ceo'

type UserRow = {
  user_id: string
  email: string | null
  full_name: string | null
  is_active: boolean
  profile_company_id: string
  profile_company_name: string
  membership_role: RoleType | null
  membership_department_id: string | null
  membership_department_name: string | null
  created_at: string
}

type Draft = { role: RoleType; departmentId: string | null }

function isPlaceholderEmail(email?: string | null) {
  return !!email && email.toLowerCase().startsWith('placeholder-admin+')
}

export default function SystemAdminConsolePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')

  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'warning'; text: string } | null>(null)

  // Create company modal
  const [showCreateCompany, setShowCreateCompany] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [createPlaceholderAdmin, setCreatePlaceholderAdmin] = useState(true)
  const [placeholderAdminName, setPlaceholderAdminName] = useState('Placeholder Admin')

  // Create department
  const [newDeptName, setNewDeptName] = useState('')

  // Move modal
  const [showMove, setShowMove] = useState(false)
  const [moveUser, setMoveUser] = useState<UserRow | null>(null)
  const [moveCompanyId, setMoveCompanyId] = useState('')
  const [moveRole, setMoveRole] = useState<RoleType>('employee')
  const [moveDeptId, setMoveDeptId] = useState('')
  const [moveDepts, setMoveDepts] = useState<Department[]>([])
  const [moveKeepActive, setMoveKeepActive] = useState(true)

  const hasRealAdmin = useMemo(() => {
    return users.some(
      (u) =>
        (u.membership_role === 'admin' || u.membership_role === 'ceo') &&
        u.is_active &&
        !isPlaceholderEmail(u.email)
    )
  }, [users])

  const placeholderAdmin = useMemo(() => users.find((u) => isPlaceholderEmail(u.email)), [users])

  function initDrafts(rows: UserRow[]) {
    const next: Record<string, Draft> = {}
    for (const u of rows) {
      next[u.user_id] = {
        role: (u.membership_role ?? 'employee') as RoleType,
        departmentId: u.membership_department_id ?? null
      }
    }
    setDrafts(next)
  }

  async function loadCompanies() {
    const { data, error } = await supabase.from('companies').select('id,name,created_at').order('created_at', { ascending: false })
    if (error) return setMsg({ variant: 'danger', text: `Failed to load companies: ${error.message}` })
    const rows = (data ?? []) as Company[]
    setCompanies(rows)
    if (!selectedCompanyId && rows.length) setSelectedCompanyId(rows[0].id)
  }

  async function loadDepartments(companyId: string) {
    const { data, error } = await supabase.from('departments').select('id,name').eq('company_id', companyId).order('name')
    if (error) return setMsg({ variant: 'danger', text: `Failed to load departments: ${error.message}` })
    setDepartments((data ?? []) as Department[])
  }

  async function loadUsers(companyId: string) {
    const { data, error } = await supabase.rpc('rpc_sys_list_users', { p_company_id: companyId })
    if (error) return setMsg({ variant: 'danger', text: `Failed to load users: ${error.message}` })
    const rows = (data ?? []) as UserRow[]
    setUsers(rows)
    initDrafts(rows)
  }

  async function refreshAll() {
    if (!selectedCompanyId) return
    setLoading(true)
    setMsg(null)
    try {
      await Promise.all([loadDepartments(selectedCompanyId), loadUsers(selectedCompanyId)])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadCompanies() }, [])
  useEffect(() => { if (selectedCompanyId) void refreshAll() }, [selectedCompanyId])

  function setDraft(userId: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [userId]: { ...(prev[userId] ?? { role: 'employee', departmentId: null }), ...patch } }))
  }

  function isDirty(u: UserRow) {
    const d = drafts[u.user_id]
    if (!d) return false
    const origRole = (u.membership_role ?? 'employee') as RoleType
    const origDept = u.membership_department_id ?? null
    const nextRole = d.role
    const nextDept = (nextRole === 'admin' || nextRole === 'ceo') ? null : d.departmentId
    return origRole !== nextRole || origDept !== nextDept
  }

  async function applyUpdate(u: UserRow) {
    const d = drafts[u.user_id]
    if (!d) return
    const nextRole = d.role
    const nextDept = (nextRole === 'admin' || nextRole === 'ceo') ? null : d.departmentId

    if ((nextRole === 'employee' || nextRole === 'manager') && !nextDept) {
      return setMsg({ variant: 'warning', text: 'Department is required for employee/manager.' })
    }

    setLoading(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('rpc_sys_set_membership_role', {
        p_company_id: selectedCompanyId,
        p_user_id: u.user_id,
        p_role: nextRole,
        p_department_id: nextDept
      })
      if (error) return setMsg({ variant: 'danger', text: `Failed to set role: ${error.message}` })
      setMsg({ variant: 'success', text: 'Updated.' })
      await loadUsers(selectedCompanyId)
    } finally {
      setLoading(false)
    }
  }

  async function setActive(userId: string, isActive: boolean) {
    setLoading(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('rpc_sys_set_profile_active', { p_user_id: userId, p_is_active: isActive })
      if (error) return setMsg({ variant: 'danger', text: `Failed to set active: ${error.message}` })
      await loadUsers(selectedCompanyId)
    } finally {
      setLoading(false)
    }
  }

  async function onCreateDepartment() {
    if (!selectedCompanyId) return
    const name = newDeptName.trim()
    if (name.length < 2) return setMsg({ variant: 'warning', text: 'Department name is too short.' })

    setLoading(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('rpc_sys_create_department', { p_company_id: selectedCompanyId, p_name: name })
      if (error) return setMsg({ variant: 'danger', text: `Create department failed: ${error.message}` })
      setNewDeptName('')
      setMsg({ variant: 'success', text: 'Department created.' })
      await loadDepartments(selectedCompanyId)
    } finally {
      setLoading(false)
    }
  }

  async function ensurePlaceholder() {
    if (!selectedCompanyId) return
    setLoading(true)
    setMsg(null)
    try {
      const { data, error } = await supabase.rpc('rpc_sys_ensure_placeholder_admin', {
        p_company_id: selectedCompanyId,
        p_placeholder_full_name: placeholderAdminName.trim() || 'Placeholder Admin'
      })
      if (error) return setMsg({ variant: 'danger', text: `Failed to ensure placeholder admin: ${error.message}` })
      if (!data || data.length === 0) setMsg({ variant: 'warning', text: 'A real active admin/CEO already exists. Placeholder not created.' })
      else setMsg({ variant: 'success', text: (data[0] as any).created ? 'Placeholder admin created.' : 'Placeholder admin already exists.' })
      await loadUsers(selectedCompanyId)
    } finally {
      setLoading(false)
    }
  }

  async function loadMoveDepartments(companyId: string) {
    const { data, error } = await supabase.from('departments').select('id,name').eq('company_id', companyId).order('name')
    if (error) return setMoveDepts([])
    setMoveDepts((data ?? []) as Department[])
  }

  function openMove(u: UserRow) {
    setMoveUser(u)
    const firstOther = companies.find((c) => c.id !== selectedCompanyId)?.id ?? selectedCompanyId
    setMoveCompanyId(firstOther)
    setMoveRole(((u.membership_role ?? 'employee') as RoleType))
    setMoveDeptId('')
    setMoveKeepActive(true)
    void loadMoveDepartments(firstOther)
    setShowMove(true)
  }

  async function doMove() {
    if (!moveUser || !moveCompanyId) return
    const deptNeeded = !(moveRole === 'admin' || moveRole === 'ceo')
    if (deptNeeded && !moveDeptId) return setMsg({ variant: 'warning', text: 'Pick a target department.' })

    setLoading(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('rpc_sys_move_user_to_company', {
        p_user_id: moveUser.user_id,
        p_target_company_id: moveCompanyId,
        p_target_role: moveRole,
        p_target_department_id: deptNeeded ? moveDeptId : null,
        p_keep_active: moveKeepActive
      })
      if (error) return setMsg({ variant: 'danger', text: `Move failed: ${error.message}` })
      setShowMove(false)
      setMoveUser(null)
      setMsg({ variant: 'success', text: 'User moved.' })
      await loadUsers(selectedCompanyId)
    } finally {
      setLoading(false)
    }
  }

  async function onCreateCompany() {
    const name = companyName.trim()
    if (name.length < 2) return setMsg({ variant: 'warning', text: 'Company name is too short.' })

    setLoading(true)
    setMsg(null)
    try {
      const { data, error } = await supabase.rpc('rpc_sys_create_company', {
        p_name: name,
        p_make_me_admin: false,
        p_create_default_department: true,
        p_default_department_name: 'General',
        p_switch_my_profile_company: false
      })
      if (error) return setMsg({ variant: 'danger', text: `Create company failed: ${error.message}` })

      const row = (data?.[0] ?? null) as any
      const newCompanyId = row?.company_id as string | undefined

      setShowCreateCompany(false)
      setCompanyName('')

      await loadCompanies()
      if (newCompanyId) {
        setSelectedCompanyId(newCompanyId)
        if (createPlaceholderAdmin) {
          await supabase.rpc('rpc_sys_ensure_placeholder_admin', {
            p_company_id: newCompanyId,
            p_placeholder_full_name: placeholderAdminName.trim() || 'Placeholder Admin'
          })
        }
        await refreshAll()
      }

      setMsg({ variant: 'success', text: `Company created: ${name}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container-xxl py-3">
      <div style={{ position: 'sticky', top: 0, zIndex: 9999, background: '#fffbeb', border: '1px solid #f59e0b', padding: 8, borderRadius: 12, marginBottom: 12 }}>
        <b>SYSTEM ADMIN UI v4</b> — Create Company + Move + Update (no auto-save)
      </div>

      <div className="d-flex align-items-center gap-2 mb-3">
        <h2 className="h5 mb-0">System Admin</h2>
        <div className="ms-auto d-flex gap-2">
          <Button variant="outline-primary" size="sm" className="rounded-pill" onClick={() => setShowCreateCompany(true)} disabled={loading}>
            + Create Company
          </Button>
          <Button variant="outline-secondary" size="sm" className="rounded-pill" onClick={() => void refreshAll()} disabled={loading || !selectedCompanyId}>
            Refresh
          </Button>
        </div>
      </div>

      {msg && <Alert variant={msg.variant}>{msg.text}</Alert>}

      <Card className="ocp-card mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <div className="col-md-6">
              <Form.Group>
                <Form.Label className="fw-semibold">Company</Form.Label>
                <Form.Select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} disabled={loading}>
                  {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </Form.Select>
              </Form.Group>
            </div>

            <div className="col-md-6">
              <Form.Group>
                <Form.Label className="fw-semibold">Create Department (scoped)</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="e.g. Procurement" />
                  <Button variant="outline-success" className="rounded-pill" onClick={() => void onCreateDepartment()} disabled={loading || !selectedCompanyId}>
                    Create
                  </Button>
                </div>
              </Form.Group>
            </div>
          </Row>

          <hr />

          {!hasRealAdmin && (
            <Alert variant="warning" className="mb-0">
              <div className="fw-semibold">No real active admin/CEO is assigned for this company.</div>
              <div className="small">
                Placeholder admin: <span className="fw-semibold">{placeholderAdmin?.full_name ?? '(none yet)'}</span>{' '}
                <span className="text-muted">{placeholderAdmin?.email ? `(${placeholderAdmin.email})` : ''}</span>
              </div>
              <div className="d-flex gap-2 flex-wrap mt-2">
                <Form.Control style={{ maxWidth: 320 }} value={placeholderAdminName} onChange={(e) => setPlaceholderAdminName(e.target.value)} />
                <Button variant="warning" className="rounded-pill" onClick={() => void ensurePlaceholder()} disabled={loading || !selectedCompanyId}>
                  Ensure placeholder admin
                </Button>
              </div>
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card className="ocp-card">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="fw-semibold">Users</div>
            {loading && <div className="small text-muted"><Spinner size="sm" animation="border" className="me-2" />Working…</div>}
          </div>

          <div className="ocp-table">
            <Table responsive className="mb-0 align-middle">
              <thead>
                <tr>
                  <th style={{ width: 260 }}>User</th>
                  <th>Email</th>
                  <th style={{ width: 120 }}>Active</th>
                  <th style={{ width: 160 }}>Role</th>
                  <th style={{ width: 220 }}>Department</th>
                  <th style={{ width: 140 }}>Update</th>
                  <th style={{ width: 120 }}>Move</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const d = drafts[u.user_id] ?? { role: (u.membership_role ?? 'employee') as RoleType, departmentId: u.membership_department_id ?? null }
                  const isAdminLike = d.role === 'admin' || d.role === 'ceo'
                  const dirty = isDirty(u)

                  return (
                    <tr key={u.user_id}>
                      <td>
                        <div className="fw-semibold">{u.full_name ?? '(no name)'}</div>
                        <div className="small text-muted font-monospace">{u.user_id.slice(0, 8)}…</div>
                        {isPlaceholderEmail(u.email) && <Badge bg="secondary" className="mt-1">placeholder</Badge>}
                      </td>
                      <td>{u.email ?? '—'}</td>
                      <td>
                        <Form.Check
                          type="switch"
                          checked={u.is_active}
                          onChange={(e) => void setActive(u.user_id, e.target.checked)}
                          disabled={loading}
                          label={u.is_active ? 'Active' : 'Inactive'}
                        />
                      </td>
                      <td>
                        <Form.Select
                          size="sm"
                          value={d.role}
                          disabled={loading}
                          onChange={(e) => {
                            const nextRole = e.target.value as RoleType
                            if (nextRole === 'admin' || nextRole === 'ceo') setDraft(u.user_id, { role: nextRole, departmentId: null })
                            else setDraft(u.user_id, { role: nextRole, departmentId: d.departmentId ?? departments[0]?.id ?? null })
                          }}
                        >
                          <option value="employee">employee</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                          <option value="ceo">ceo</option>
                        </Form.Select>
                      </td>
                      <td>
                        <Form.Select
                          size="sm"
                          value={d.departmentId ?? ''}
                          disabled={loading || isAdminLike}
                          onChange={(e) => setDraft(u.user_id, { departmentId: e.target.value || null })}
                        >
                          <option value="">{isAdminLike ? '(none)' : '(select)'}</option>
                          {departments.map((dept) => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
                        </Form.Select>
                      </td>
                      <td>
                        <Button variant={dirty ? 'primary' : 'outline-secondary'} size="sm" className="rounded-pill w-100" disabled={loading || !dirty} onClick={() => void applyUpdate(u)}>
                          Update
                        </Button>
                      </td>
                      <td>
                        <Button variant="outline-primary" size="sm" className="rounded-pill w-100" disabled={loading} onClick={() => openMove(u)}>
                          Move
                        </Button>
                      </td>
                    </tr>
                  )
                })}
                {!users.length && (
                  <tr><td colSpan={7} className="text-center text-muted py-4">No users found for this company.</td></tr>
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      <Modal show={showMove} onHide={() => setShowMove(false)} centered backdrop="static">
        <Modal.Header closeButton><Modal.Title>Move user</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="mb-2">
            <div className="fw-semibold">{moveUser?.full_name ?? '(no name)'}</div>
            <div className="small text-muted">{moveUser?.email ?? '—'}</div>
          </div>

          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Target company</Form.Label>
            <Form.Select value={moveCompanyId} onChange={(e) => { const cid = e.target.value; setMoveCompanyId(cid); setMoveDeptId(''); void loadMoveDepartments(cid) }}>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Form.Select>
          </Form.Group>

          <Row className="g-2">
            <div className="col-md-6">
              <Form.Group>
                <Form.Label className="fw-semibold">Role</Form.Label>
                <Form.Select value={moveRole} onChange={(e) => { const r = e.target.value as RoleType; setMoveRole(r); if (r === 'admin' || r === 'ceo') setMoveDeptId('') }}>
                  <option value="employee">employee</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                  <option value="ceo">ceo</option>
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group>
                <Form.Label className="fw-semibold">Department</Form.Label>
                <Form.Select value={moveDeptId} disabled={moveRole === 'admin' || moveRole === 'ceo'} onChange={(e) => setMoveDeptId(e.target.value)}>
                  <option value="">{moveRole === 'admin' || moveRole === 'ceo' ? '(none)' : '(select)'}</option>
                  {moveDepts.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                </Form.Select>
              </Form.Group>
            </div>
          </Row>

          <Form.Check className="mt-3" type="switch" id="keepActive" label="Keep user active" checked={moveKeepActive} onChange={(e) => setMoveKeepActive(e.target.checked)} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowMove(false)} disabled={loading}>Cancel</Button>
          <Button variant="primary" className="rounded-pill" onClick={() => void doMove()} disabled={loading || !moveCompanyId}>
            {loading ? <Spinner size="sm" animation="border" /> : 'Move'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showCreateCompany} onHide={() => setShowCreateCompany(false)} centered backdrop="static">
        <Modal.Header closeButton><Modal.Title>Create Company</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Company name</Form.Label>
            <Form.Control value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. New Customer Co" />
          </Form.Group>

          <Form.Check
            type="switch"
            id="createPlaceholderAdmin"
            label="Create placeholder admin (if no real admin exists)"
            checked={createPlaceholderAdmin}
            onChange={(e) => setCreatePlaceholderAdmin(e.target.checked)}
            className="mb-3"
          />

          {createPlaceholderAdmin && (
            <Form.Group>
              <Form.Label className="fw-semibold">Placeholder admin name</Form.Label>
              <Form.Control value={placeholderAdminName} onChange={(e) => setPlaceholderAdminName(e.target.value)} />
            </Form.Group>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowCreateCompany(false)} disabled={loading}>Cancel</Button>
          <Button variant="primary" className="rounded-pill" onClick={() => void onCreateCompany()} disabled={loading}>
            {loading ? <Spinner size="sm" animation="border" /> : 'Create'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
