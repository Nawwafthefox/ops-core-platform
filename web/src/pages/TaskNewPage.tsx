import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { DepartmentRow, ProfileRow, RequestTypeRow } from '../lib/types'

export function TaskNewPage() {
  const nav = useNavigate()
  const { ctx } = useAuth()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [requestTypes, setRequestTypes] = useState<RequestTypeRow[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [assignees, setAssignees] = useState<ProfileRow[]>([])

  const [requestTypeId, setRequestTypeId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetDeptId, setTargetDeptId] = useState<string>('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [priority, setPriority] = useState<number>(3)
  const [dueAt, setDueAt] = useState<string>('')

  // Optional metadata (Policy blueprint)
  const [amount, setAmount] = useState<string>('')
  const [currency, setCurrency] = useState<string>('SAR')
  const [costCenter, setCostCenter] = useState<string>('')
  const [projectCode, setProjectCode] = useState<string>('')
  const [externalRef, setExternalRef] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [riskLevel, setRiskLevel] = useState<string>('')

  const canPickAssignee = useMemo(() => {
    if (!ctx) return false
    if (ctx.role === 'admin' || ctx.role === 'ceo') return Boolean(targetDeptId)
    if (ctx.role === 'manager') return Boolean(targetDeptId && ctx.department_id && targetDeptId === ctx.department_id)
    return false
  }, [ctx, targetDeptId])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setErr(null)
      try {
        const [{ data: rt, error: rtErr }, { data: depts, error: dErr }] = await Promise.all([
          supabase.from('request_types').select('*').eq('active', true).order('name'),
          supabase.from('departments').select('*').order('name')
        ])
        if (rtErr) throw rtErr
        if (dErr) throw dErr
        setRequestTypes((rt as RequestTypeRow[]) ?? [])
        setDepartments((depts as DepartmentRow[]) ?? [])

        if (rt && rt.length) {
          setRequestTypeId((rt[0] as RequestTypeRow).id)
          setPriority((rt[0] as RequestTypeRow).default_priority ?? 3)
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  useEffect(() => {
    const loadAssignees = async () => {
      setAssignees([])
      setAssigneeId('')
      if (!canPickAssignee || !targetDeptId) return

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('department_id', targetDeptId)
        .eq('is_active', true)
        .order('full_name')

      if (error) {
        // eslint-disable-next-line no-console
        console.warn('Assignee query error:', error.message)
        return
      }

      setAssignees((data as ProfileRow[]) ?? [])
    }

    loadAssignees()
  }, [canPickAssignee, targetDeptId])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)

    if (!requestTypeId) return setErr(t('task_new.err_request_type_required'))
    if (!title.trim()) return setErr(t('task_new.err_title_required'))
    if (!targetDeptId) return setErr(t('task_new.err_target_dept_required'))

    setSaving(true)
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null

      const amountNum = amount.trim() ? Number(amount.trim()) : null
      if (amountNum !== null && !Number.isFinite(amountNum)) {
        throw new Error(t('task_new.err_amount_number'))
      }

      const { data, error } = await supabase.rpc('rpc_create_request', {
        p_request_type_id: requestTypeId,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_target_department_id: targetDeptId,
        p_target_assignee_id: assigneeId || null,
        p_priority: priority,
        p_due_at: dueIso,

        // Optional metadata (Policy blueprint)
        p_amount: amountNum,
        p_currency: currency.trim() || null,
        p_cost_center: costCenter.trim() || null,
        p_project_code: projectCode.trim() || null,
        p_external_ref: externalRef.trim() || null,
        p_category: category.trim() || null,
        p_risk_level: riskLevel.trim() || null
      })

      if (error) throw error
      const requestId = data as string
      nav(`/tasks/${requestId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" />
      </div>
    )
  }

  return (
    <Card className="ocp-card">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <div className="fw-semibold" style={{ fontSize: 18 }}>
              {t('task_new.title')}
            </div>
            <div className="ocp-muted">{t('task_new.subtitle')}</div>
          </div>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => nav('/tasks')}>
            {t('task_new.back')}
          </Button>
        </div>

        {err && <Alert variant="danger">{err}</Alert>}

        <Form onSubmit={onSubmit}>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>{t('task_new.request_type')}</Form.Label>
                <Form.Select
                  value={requestTypeId}
                  onChange={(e) => {
                    const id = e.target.value
                    setRequestTypeId(id)
                    const rt = requestTypes.find((x) => x.id === id)
                    if (rt) setPriority(rt.default_priority ?? 3)
                  }}
                >
                  {requestTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>{t('task_new.priority')}</Form.Label>
                <Form.Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                  <option value={1}>{t('task_new.low')}</option>
                  <option value={2}>{t('task_new.medium')}</option>
                  <option value={3}>{t('task_new.high')}</option>
                  <option value={4}>{t('task_new.critical')}</option>
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>{t('task_new.due_date')}</Form.Label>
                <Form.Control type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>{t('task_new.title_label')}</Form.Label>
                <Form.Control value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('task_new.title_placeholder')} />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>{t('task_new.description')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('task_new.description_placeholder')}
                />
              </Form.Group>
            </Col>

            <Col md={12}>
              <div className="border rounded-3 p-3 bg-white">
                <div className="fw-semibold mb-2">{t('task_new.optional_details')}</div>
                <Row className="g-3">
                  <Col md={4}>
                    <Form.Group>
                      <Form.Label>{t('task_new.amount')}</Form.Label>
                      <Form.Control
                        type="number"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={t('task_new.amount_placeholder')}
                      />
                      <div className="small ocp-muted mt-1">{t('task_new.amount_help')}</div>
                    </Form.Group>
                  </Col>

                  <Col md={2}>
                    <Form.Group>
                      <Form.Label>{t('task_new.currency')}</Form.Label>
                      <Form.Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        <option value="SAR">SAR</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>{t('task_new.cost_center')}</Form.Label>
                      <Form.Control value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder={t('task_new.cost_center_placeholder')} />
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>{t('task_new.project')}</Form.Label>
                      <Form.Control value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder={t('task_new.project_placeholder')} />
                    </Form.Group>
                  </Col>

                  <Col md={4}>
                    <Form.Group>
                      <Form.Label>{t('task_new.external_reference')}</Form.Label>
                      <Form.Control value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder={t('task_new.external_reference_placeholder')} />
                    </Form.Group>
                  </Col>

                  <Col md={4}>
                    <Form.Group>
                      <Form.Label>{t('task_new.category')}</Form.Label>
                      <Form.Control value={category} onChange={(e) => setCategory(e.target.value)} />
                    </Form.Group>
                  </Col>

                  <Col md={4}>
                    <Form.Group>
                      <Form.Label>{t('task_new.risk_level')}</Form.Label>
                      <Form.Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
                        <option value="">{t('task_new.none')}</option>
                        <option value="low">{t('task_new.low')}</option>
                        <option value="medium">{t('task_new.medium')}</option>
                        <option value="high">{t('task_new.high')}</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
              </div>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>{t('task_new.target_department')}</Form.Label>
                <Form.Select value={targetDeptId} onChange={(e) => setTargetDeptId(e.target.value)}>
                  <option value="">{t('task_new.select')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Form.Select>
                <div className="small ocp-muted mt-2">{t('task_new.target_help')}</div>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>{t('task_new.assignee_optional')}</Form.Label>
                <Form.Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!canPickAssignee}>
                  <option value="">{canPickAssignee ? t('task_new.unassigned') : t('task_new.auto_manager_assignment')}</option>
                  {assignees.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
                </Form.Select>
                <div className="small ocp-muted mt-2">{t('task_new.assignee_help')}</div>
              </Form.Group>
            </Col>

            <Col md={12} className="pt-2">
              <Button type="submit" className="rounded-pill px-4" disabled={saving}>
                {saving ? <Spinner size="sm" animation="border" /> : t('task_new.create_request')}
              </Button>
            </Col>
          </Row>
        </Form>
      </Card.Body>
    </Card>
  )
}
