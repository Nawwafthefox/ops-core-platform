import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

type Company = { id: string; name: string; created_at?: string }
type RoleType = 'employee' | 'manager' | 'admin' | 'ceo'
type Department = { id: string; name: string }

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

function Badge({ children, tone }: { children: React.ReactNode; tone: 'green' | 'red' | 'gray' | 'blue' }) {
  const cls =
    tone === 'green'
      ? 'badge text-bg-success'
      : tone === 'red'
      ? 'badge text-bg-danger'
      : tone === 'blue'
      ? 'badge text-bg-primary'
      : 'badge text-bg-secondary'
  return <span className={cls}>{children}</span>
}

export default function SystemAdminConsolePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')

  const [users, setUsers] = useState<UserRow[]>([])
  const [departments, setDepartments] = useState<Department[]>([])

  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null)

  // Create company modal state
  const [showCreate, setShowCreate] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [switchProfileToNewCompany, setSwitchProfileToNewCompany] = useState(true)

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  )

  function setMsg(tone: 'success' | 'danger' | 'warning', text: string) {
    setToast({ tone, text })
    // auto-clear after a bit
    window.setTimeout(() => setToast(null), 3500)
  }

  async function loadCompanies() {
    const { data, error } = await supabase.from('companies').select('id,name,created_at').order('created_at', { ascending: false })
    if (error) return setMsg('danger', `Failed to load companies: ${error.message}`)
    const rows = (data ?? []) as Company[]
    setCompanies(rows)
    if (!selectedCompanyId && rows.length > 0) setSelectedCompanyId(rows[0].id)
  }

  async function loadDepartments(companyId: string) {
    const { data, error } = await supabase.from('departments').select('id,name').eq('company_id', companyId).order('name', { ascending: true })
    if (error) {
      setDepartments([])
      return setMsg('danger', `Failed to load departments: ${error.message}`)
    }
    setDepartments((data ?? []) as Department[])
  }

  async function loadUsers(companyId: string) {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('rpc_sys_list_users', { p_company_id: companyId })
      if (error) {
        setUsers([])
        return setMsg('danger', `Failed to load users: ${error.message}`)
      }
      setUsers((data ?? []) as UserRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCompanies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedCompanyId) return
    void loadDepartments(selectedCompanyId)
    void loadUsers(selectedCompanyId)
  }, [selectedCompanyId])

  async function onCreateCompany() {
    const name = newCompanyName.trim()
    if (name.length < 2) return setMsg('warning', 'Company name is too short.')

    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('rpc_sys_create_company', {
        p_name: name,
        p_make_me_admin: true,
        p_create_default_department: true,
        p_default_department_name: 'General',
        p_switch_my_profile_company: switchProfileToNewCompany,
      })

      if (error) return setMsg('danger', `Create company failed: ${error.message}`)

      const row = (data?.[0] ?? null) as any
      setShowCreate(false)
      setNewCompanyName('')
      await loadCompanies()
      if (row?.company_id) setSelectedCompanyId(row.company_id)
      setMsg('success', `Created company: ${row?.company_name ?? name}`)
    } finally {
      setLoading(false)
    }
  }

  async function setActive(userId: string, isActive: boolean) {
    const { error } = await supabase.rpc('rpc_sys_set_profile_active', { p_user_id: userId, p_is_active: isActive })
    if (error) return setMsg('danger', `Failed to set active: ${error.message}`)
    setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, is_active: isActive } : u)))
    setMsg('success', `User ${isActive ? 'activated' : 'deactivated'}.`)
  }

  async function removeMembership(companyId: string, userId: string) {
    const ok = window.confirm('Remove this user from the company? (This removes membership only.)')
    if (!ok) return

    const { data, error } = await supabase.rpc('rpc_sys_remove_membership', { p_company_id: companyId, p_user_id: userId })
    if (error) return setMsg('danger', `Failed to remove membership: ${error.message}`)
    const removed = Boolean((data?.[0] as any)?.removed)
    setMsg(removed ? 'success' : 'warning', removed ? 'Membership removed.' : 'No membership removed.')
    await loadUsers(companyId)
  }

  async function setRole(companyId: string, userId: string, role: RoleType, departmentId: string | null) {
    const { error } = await supabase.rpc('rpc_sys_set_membership_role', {
      p_company_id: companyId,
      p_user_id: userId,
      p_role: role,
      p_department_id: departmentId,
    })
    if (error) return setMsg('danger', `Failed to set role: ${error.message}`)
    setMsg('success', 'Role updated.')
    await loadUsers(companyId)
  }

  return (
    <div className="container-xxl py-3">
      <div className="d-flex align-items-center gap-2 mb-3">
        <h2 className="h4 mb-0">
          <i className="bi bi-shield-lock me-2" />
          System Admin
        </h2>

        <div className="ms-auto d-flex gap-2">
          <button className="btn btn-outline-primary btn-sm" onClick={() => setShowCreate(true)} disabled={loading}>
            <i className="bi bi-plus-circle me-1" />
            Create Company
          </button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => selectedCompanyId && loadUsers(selectedCompanyId)} disabled={loading || !selectedCompanyId}>
            <i className="bi bi-arrow-repeat me-1" />
            Refresh
          </button>
        </div>
      </div>

      {toast && (
        <div className={`alert alert-${toast.tone} py-2`} role="alert">
          {toast.text}
        </div>
      )}

      <div className="card shadow-sm mb-3">
        <div className="card-body d-flex flex-wrap align-items-center gap-3">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold">Company</span>
            <select
              className="form-select form-select-sm"
              style={{ minWidth: 280 }}
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              disabled={loading}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ms-auto d-flex align-items-center gap-2 text-muted">
            {selectedCompany ? (
              <>
                <span>{users.length} users</span>
                <span>•</span>
                <span>{departments.length} departments</span>
              </>
            ) : (
              <span>No company selected</span>
            )}
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-header bg-white d-flex align-items-center">
          <div className="fw-semibold">Users</div>
          {loading && (
            <div className="ms-auto small text-muted">
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
              Loading…
            </div>
          )}
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: 280 }}>User</th>
                <th>Email</th>
                <th style={{ width: 120 }}>Active</th>
                <th style={{ width: 160 }}>Role</th>
                <th style={{ width: 240 }}>Department</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const role = (u.membership_role ?? 'employee') as RoleType
                const isAdminLike = role === 'admin' || role === 'ceo'

                return (
                  <tr key={u.user_id}>
                    <td>
                      <div className="fw-semibold">{u.full_name ?? '(no name)'}</div>
                      <div className="small text-muted font-monospace">{u.user_id.slice(0, 8)}…</div>
                    </td>

                    <td>{u.email ?? <span className="text-muted">(no email)</span>}</td>

                    <td>
                      {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}
                      <div className="form-check form-switch mt-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={u.is_active}
                          onChange={(e) => void setActive(u.user_id, e.target.checked)}
                        />
                      </div>
                    </td>

                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={role}
                        onChange={(e) => {
                          const nextRole = e.target.value as RoleType
                          if (nextRole === 'admin' || nextRole === 'ceo') {
                            void setRole(selectedCompanyId, u.user_id, nextRole, null)
                          } else {
                            const fallbackDept = u.membership_department_id ?? departments[0]?.id ?? null
                            void setRole(selectedCompanyId, u.user_id, nextRole, fallbackDept)
                          }
                        }}
                      >
                        <option value="employee">employee</option>
                        <option value="manager">manager</option>
                        <option value="admin">admin</option>
                        <option value="ceo">ceo</option>
                      </select>
                      <div className="small text-muted mt-1">
                        {isAdminLike ? 'Company-scoped' : 'Department-scoped'}
                      </div>
                    </td>

                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={u.membership_department_id ?? ''}
                        disabled={isAdminLike}
                        onChange={(e) => void setRole(selectedCompanyId, u.user_id, role, e.target.value || null)}
                      >
                        <option value="">{isAdminLike ? '(none)' : '(select)'}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="text-end">
                      <button className="btn btn-outline-danger btn-sm" onClick={() => void removeMembership(selectedCompanyId, u.user_id)} disabled={loading}>
                        <i className="bi bi-person-x me-1" />
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}

              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="text-muted py-4 text-center">
                    No users found for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showCreate && (
        <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
          <div className="modal-dialog modal-dialog-centered" role="document">
            <div className="modal-content shadow">
              <div className="modal-header">
                <h5 className="modal-title">Create Company</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setShowCreate(false)} />
              </div>

              <div className="modal-body">
                <label className="form-label fw-semibold">Company name</label>
                <input
                  className="form-control"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g., New Customer Co"
                />

                <div className="form-check mt-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="switchProfile"
                    checked={switchProfileToNewCompany}
                    onChange={(e) => setSwitchProfileToNewCompany(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="switchProfile">
                    Switch my profile company to the new company (single-company mode)
                  </label>
                </div>

                <div className="small text-muted mt-3">
                  This calls <code>rpc_sys_create_company</code> and makes you admin of the new company.
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowCreate(false)} disabled={loading}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => void onCreateCompany()} disabled={loading}>
                  {loading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>

          {/* Backdrop */}
          <div className="modal-backdrop fade show" onClick={() => setShowCreate(false)} />
        </div>
      )}
    </div>
  )
}
