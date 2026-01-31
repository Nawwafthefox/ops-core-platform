import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type { DepartmentRow, ProfileRow, RequestTypeRow } from '../lib/types'

export function TaskNewPage() {
  const nav = useNavigate()
  const { ctx } = useAuth()

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
          supabase.from('departments').select('*').order('name'),
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

    if (!requestTypeId) return setErr('Request type is required')
    if (!title.trim()) return setErr('Title is required')
    if (!targetDeptId) return setErr('Target department is required')

    setSaving(true)
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null

      const { data, error } = await supabase.rpc('rpc_create_request', {
        p_request_type_id: requestTypeId,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_target_department_id: targetDeptId,
        p_target_assignee_id: assigneeId || null,
        p_priority: priority,
        p_due_at: dueIso,
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
              Create a request
            </div>
            <div className="ocp-muted">
              Create → route to a department → assign → execute → approve → forward/close.
            </div>
          </div>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => nav('/tasks')}>
            Back
          </Button>
        </div>

        {err && <Alert variant="danger">{err}</Alert>}

        <Form onSubmit={onSubmit}>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Request type</Form.Label>
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
                <Form.Label>Priority</Form.Label>
                <Form.Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                  <option value={1}>Low</option>
                  <option value={2}>Medium</option>
                  <option value={3}>High</option>
                  <option value={4}>Critical</option>
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>Due date</Form.Label>
                <Form.Control type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>Title</Form.Label>
                <Form.Control value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details, context, acceptance criteria, constraints..."
                />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Target department</Form.Label>
                <Form.Select value={targetDeptId} onChange={(e) => setTargetDeptId(e.target.value)}>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Form.Select>
                <div className="small ocp-muted mt-2">
                  Managers can only assign within their own department. Admin/CEO can assign for any department.
                </div>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Assignee (optional)</Form.Label>
                <Form.Select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  disabled={!canPickAssignee}
                >
                  <option value="">{canPickAssignee ? 'Unassigned' : 'Auto / Manager assignment'}</option>
                  {assignees.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
                </Form.Select>
                <div className="small ocp-muted mt-2">If left unassigned, the receiving department manager assigns it.</div>
              </Form.Group>
            </Col>

            <Col md={12} className="pt-2">
              <Button type="submit" className="rounded-pill px-4" disabled={saving}>
                {saving ? <Spinner size="sm" animation="border" /> : 'Create request'}
              </Button>
            </Col>
          </Row>
        </Form>
      </Card.Body>
    </Card>
  )
}
