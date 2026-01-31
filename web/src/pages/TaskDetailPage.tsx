import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthProvider'
import type {
  AttachmentRow,
  CommentRow,
  DepartmentRow,
  ProfileRow,
  RequestCurrentRow,
  RequestEventRow,
  RequestStepRow,
} from '../lib/types'
import { fmtDateTime, fmtFromNow, fmtHoursDays, priorityLabel } from '../lib/format'
import { RequestStatusBadge, StepStatusBadge } from '../components/StatusBadge'

export function TaskDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { ctx } = useAuth()

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [request, setRequest] = useState<RequestCurrentRow | null>(null)
  const [steps, setSteps] = useState<RequestStepRow[]>([])
  const [events, setEvents] = useState<RequestEventRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])

  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [deptPeople, setDeptPeople] = useState<ProfileRow[]>([])

  // UI state
  const [commentBody, setCommentBody] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [approvalNotes, setApprovalNotes] = useState('')
  const [returnReason, setReturnReason] = useState('')

  const [assignUserId, setAssignUserId] = useState('')

  const [showComplete, setShowComplete] = useState(false)
  const [showApprove, setShowApprove] = useState(false)
  const [showReturn, setShowReturn] = useState(false)

  const [nextDeptId, setNextDeptId] = useState('')
  const [nextAssigneeId, setNextAssigneeId] = useState('')
  const [returnDeptId, setReturnDeptId] = useState('')
  const [returnAssigneeId, setReturnAssigneeId] = useState('')

  const currentStep = useMemo(() => {
    if (!request?.current_step_id) return null
    return steps.find((s) => s.id === request.current_step_id) ?? null
  }, [request?.current_step_id, steps])

  const isCurrentAssignee = useMemo(() => {
    return !!ctx?.user_id && !!request?.current_assignee_id && ctx.user_id === request.current_assignee_id
  }, [ctx?.user_id, request?.current_assignee_id])

  const canManageCurrentDept = useMemo(() => {
    if (!ctx || !request?.current_department_id) return false
    if (ctx.role === 'admin' || ctx.role === 'ceo') return true
    if (ctx.role === 'manager' && ctx.department_id) return ctx.department_id === request.current_department_id
    return false
  }, [ctx, request?.current_department_id])

  const canAssign = useMemo(() => {
    if (!canManageCurrentDept || !currentStep) return false
    return ['queued', 'in_progress'].includes(currentStep.status)
  }, [canManageCurrentDept, currentStep])

  const canApprove = useMemo(() => {
    if (!canManageCurrentDept || !currentStep) return false
    return currentStep.status === 'done_pending_approval'
  }, [canManageCurrentDept, currentStep])

  const canReturn = useMemo(() => {
    if (!canManageCurrentDept || !currentStep) return false
    return ['queued', 'in_progress', 'done_pending_approval'].includes(currentStep.status)
  }, [canManageCurrentDept, currentStep])

  const canPickNextAssignee = useMemo(() => {
    if (!ctx) return false
    if (!nextDeptId) return false
    if (ctx.role === 'admin' || ctx.role === 'ceo') return true
    if (ctx.role === 'manager') return ctx.department_id === nextDeptId
    return false
  }, [ctx, nextDeptId])

  const canPickReturnAssignee = useMemo(() => {
    if (!ctx) return false
    if (!returnDeptId) return false
    if (ctx.role === 'admin' || ctx.role === 'ceo') return true
    if (ctx.role === 'manager') return ctx.department_id === returnDeptId
    return false
  }, [ctx, returnDeptId])

  const loadAll = async () => {
    if (!id) return
    setLoading(true)
    setErr(null)
    try {
      const [{ data: req, error: reqErr }, { data: stepsData, error: sErr }] = await Promise.all([
        supabase.from('v_requests_current').select('*').eq('id', id).maybeSingle(),
        supabase.from('request_steps').select('*').eq('request_id', id).order('step_no', { ascending: true }),
      ])
      if (reqErr) throw reqErr
      if (sErr) throw sErr
      setRequest((req as RequestCurrentRow) ?? null)
      setSteps((stepsData as RequestStepRow[]) ?? [])

      const [{ data: ev, error: evErr }, { data: co, error: coErr }, { data: at, error: atErr }] =
        await Promise.all([
          supabase.from('request_events').select('*').eq('request_id', id).order('created_at', { ascending: false }).limit(100),
          supabase.from('request_comments').select('*').eq('request_id', id).order('created_at', { ascending: true }),
          supabase.from('request_attachments').select('*').eq('request_id', id).order('created_at', { ascending: true }),
        ])

      if (evErr) throw evErr
      if (coErr) throw coErr
      if (atErr) throw atErr
      setEvents((ev as RequestEventRow[]) ?? [])
      setComments((co as CommentRow[]) ?? [])
      setAttachments((at as AttachmentRow[]) ?? [])

      const { data: depts, error: dErr } = await supabase.from('departments').select('*').order('name')
      if (dErr) throw dErr
      setDepartments((depts as DepartmentRow[]) ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const loadDeptPeople = async () => {
      setDeptPeople([])
      setAssignUserId('')
      if (!request?.current_department_id) return
      if (!canManageCurrentDept) return

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('department_id', request.current_department_id)
        .eq('is_active', true)
        .order('full_name')

      if (error) {
        // eslint-disable-next-line no-console
        console.warn('profiles query error', error.message)
        return
      }
      setDeptPeople((data as ProfileRow[]) ?? [])
    }

    loadDeptPeople()
  }, [request?.current_department_id, canManageCurrentDept])

  const doAssign = async () => {
    if (!currentStep?.id) return
    if (!assignUserId) return setErr('Select a user to assign.')
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_assign_step', { p_step_id: currentStep.id, p_assignee_id: assignUserId })
      if (error) throw error
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doStart = async () => {
    if (!currentStep?.id) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_start_step', { p_step_id: currentStep.id })
      if (error) throw error
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doComplete = async () => {
    if (!currentStep?.id) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_complete_step', {
        p_step_id: currentStep.id,
        p_completion_notes: completionNotes.trim() || null,
      })
      if (error) throw error
      setShowComplete(false)
      setCompletionNotes('')
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doApprove = async () => {
    if (!currentStep?.id) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_approve_step', {
        p_step_id: currentStep.id,
        p_next_department_id: nextDeptId || null,
        p_next_assignee_id: nextAssigneeId || null,
        p_approval_notes: approvalNotes.trim() || null,
      })
      if (error) throw error
      setShowApprove(false)
      setApprovalNotes('')
      setNextDeptId('')
      setNextAssigneeId('')
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doReturn = async () => {
    if (!currentStep?.id) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_return_step', {
        p_step_id: currentStep.id,
        p_reason: returnReason.trim(),
        p_return_to_department_id: returnDeptId || null,
        p_return_to_assignee_id: returnAssigneeId || null,
      })
      if (error) throw error
      setShowReturn(false)
      setReturnReason('')
      setReturnDeptId('')
      setReturnAssigneeId('')
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const addComment = async () => {
    if (!id) return
    if (!commentBody.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('rpc_add_comment', {
        p_request_id: id,
        p_step_id: request?.current_step_id ?? null,
        p_body: commentBody.trim(),
      })
      if (error) throw error
      setCommentBody('')
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const uploadAttachment = async (file: File) => {
    if (!id) return
    setBusy(true)
    setErr(null)
    try {
      const bucket = 'request-attachments'
      const safeName = file.name.replaceAll(' ', '_')
      const path = `requests/${id}/${Date.now()}_${safeName}`

      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      })
      if (upErr) throw upErr

      const { error: metaErr } = await supabase.rpc('rpc_add_attachment', {
        p_request_id: id,
        p_step_id: request?.current_step_id ?? null,
        p_storage_path: path,
        p_file_name: file.name,
        p_mime_type: file.type || null,
        p_byte_size: file.size,
      })
      if (metaErr) throw metaErr

      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openAttachment = async (a: AttachmentRow) => {
    setBusy(true)
    setErr(null)
    try {
      const { data, error } = await supabase.storage.from(a.storage_bucket).createSignedUrl(a.storage_path, 60 * 30)
      if (error) throw error
      if (!data?.signedUrl) throw new Error('No signed URL returned')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Load next department assignees on demand (admin/ceo, or same dept manager)
  const [nextPeople, setNextPeople] = useState<ProfileRow[]>([])
  useEffect(() => {
    const load = async () => {
      setNextPeople([])
      setNextAssigneeId('')
      if (!canPickNextAssignee || !nextDeptId) return

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('department_id', nextDeptId)
        .eq('is_active', true)
        .order('full_name')
      if (error) return
      setNextPeople((data as ProfileRow[]) ?? [])
    }
    load()
  }, [canPickNextAssignee, nextDeptId])

  const [returnPeople, setReturnPeople] = useState<ProfileRow[]>([])
  useEffect(() => {
    const load = async () => {
      setReturnPeople([])
      setReturnAssigneeId('')
      if (!canPickReturnAssignee || !returnDeptId) return

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('department_id', returnDeptId)
        .eq('is_active', true)
        .order('full_name')
      if (error) return
      setReturnPeople((data as ProfileRow[]) ?? [])
    }
    load()
  }, [canPickReturnAssignee, returnDeptId])

  useEffect(() => {
    // Default return dept to previous (from_department_id) if present
    if (!showReturn) return
    if (!currentStep?.from_department_id) return
    setReturnDeptId(currentStep.from_department_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReturn])

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" />
      </div>
    )
  }

  if (!request) {
    return (
      <Alert variant="danger" className="ocp-card p-4">
        Request not found or not accessible.
        <div className="mt-3">
          <Button variant="outline-secondary" onClick={() => nav('/tasks')}>
            Back
          </Button>
        </div>
      </Alert>
    )
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="ocp-code">{request.reference_code}</span>
            <RequestStatusBadge status={request.request_status} />
            <StepStatusBadge status={request.current_step_status} />
          </div>
          <div className="fw-semibold mt-2" style={{ fontSize: 20 }}>
            {request.title}
          </div>
          <div className="ocp-muted small mt-1">
            Requested by <span className="fw-semibold">{request.requester_name ?? '—'}</span> •{' '}
            {request.origin_department_name ?? '—'} • Created {fmtFromNow(request.created_at)}
          </div>
        </div>

        <div className="d-flex gap-2">
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => nav('/tasks')}>
            Back
          </Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      <Row className="g-3">
        <Col lg={8}>
          <Card className="ocp-card mb-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                  <div className="fw-semibold">Current step</div>
                  <div className="small ocp-muted">
                    Department: <span className="fw-semibold">{request.current_department_name ?? '—'}</span> • Assignee:{' '}
                    <span className="fw-semibold">{request.current_assignee_name ?? 'Unassigned'}</span>
                  </div>
                </div>

                <div className="d-flex gap-2 flex-wrap">
                  {canAssign && (
                    <div className="d-flex gap-2 align-items-center">
                      <Form.Select
                        value={assignUserId}
                        onChange={(e) => setAssignUserId(e.target.value)}
                        style={{ width: 220 }}
                        disabled={busy}
                      >
                        <option value="">Assign to…</option>
                        {deptPeople.map((p) => (
                          <option key={p.user_id} value={p.user_id}>
                            {p.full_name}
                          </option>
                        ))}
                      </Form.Select>
                      <Button
                        variant="outline-primary"
                        className="rounded-pill"
                        onClick={() => doAssign()}
                        disabled={busy || !assignUserId}
                      >
                        <i className="bi bi-person-check me-2" />
                        Assign
                      </Button>
                    </div>
                  )}

                  {isCurrentAssignee && currentStep?.status === 'queued' && (
                    <Button className="rounded-pill" onClick={() => doStart()} disabled={busy}>
                      <i className="bi bi-play-circle me-2" />
                      Start
                    </Button>
                  )}

                  {isCurrentAssignee && (currentStep?.status === 'queued' || currentStep?.status === 'in_progress') && (
                    <Button variant="outline-success" className="rounded-pill" onClick={() => setShowComplete(true)} disabled={busy}>
                      <i className="bi bi-check2-circle me-2" />
                      Mark done
                    </Button>
                  )}

                  {canApprove && (
                    <Button variant="success" className="rounded-pill" onClick={() => setShowApprove(true)} disabled={busy}>
                      <i className="bi bi-patch-check me-2" />
                      Approve / Forward
                    </Button>
                  )}

                  {canReturn && (
                    <Button variant="outline-danger" className="rounded-pill" onClick={() => setShowReturn(true)} disabled={busy}>
                      <i className="bi bi-arrow-counterclockwise me-2" />
                      Return
                    </Button>
                  )}
                </div>
              </div>

              <hr />

              <Row className="g-3">
                <Col md={4}>
                  <div className="small ocp-muted">Type</div>
                  <div className="fw-semibold">{request.request_type_name ?? '—'}</div>
                </Col>
                <Col md={4}>
                  <div className="small ocp-muted">Priority</div>
                  <Badge bg="light" text="dark" className="rounded-pill px-3 py-2 border">
                    {priorityLabel(request.priority)}
                  </Badge>
                </Col>
                <Col md={4}>
                  <div className="small ocp-muted">Due</div>
                  <div className="fw-semibold">{fmtDateTime(request.due_at)}</div>
                </Col>
              </Row>

              {request.description && (
                <>
                  <hr />
                  <div className="fw-semibold mb-1">Description</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{request.description}</div>
                </>
              )}
            </Card.Body>
          </Card>

          <Card className="ocp-card mb-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="fw-semibold">Comments</div>
                  <div className="small ocp-muted">Conversation thread (logged)</div>
                </div>
              </div>

              <div className="mt-3">
                {comments.length ? (
                  <div className="ocp-timeline">
                    {comments.map((c) => (
                      <div key={c.id} className="ocp-timeline-item">
                        <div className="ocp-timeline-dot" />
                        <div className="ocp-timeline-title">User {c.user_id.slice(0, 8)}</div>
                        <div className="ocp-timeline-meta">{fmtDateTime(c.created_at)}</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted">No comments yet.</div>
                )}
              </div>

              <hr />

              <Form.Group>
                <Form.Label className="fw-semibold">Add comment</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Write a note, question, or handoff detail…"
                />
              </Form.Group>

              <div className="d-flex justify-content-end mt-2">
                <Button className="rounded-pill" onClick={() => addComment()} disabled={busy || !commentBody.trim()}>
                  <i className="bi bi-send me-2" />
                  Send
                </Button>
              </div>
            </Card.Body>
          </Card>

          <Card className="ocp-card">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <div className="fw-semibold">Attachments</div>
                  <div className="small ocp-muted">Stored in Supabase Storage (private bucket)</div>
                </div>
                <Form.Group controlId="fileUpload" className="mb-0">
                  <Form.Label className="btn btn-outline-primary rounded-pill mb-0">
                    <i className="bi bi-paperclip me-2" />
                    Upload
                    <Form.Control
                      type="file"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void uploadAttachment(file)
                        e.currentTarget.value = ''
                      }}
                      disabled={busy}
                    />
                  </Form.Label>
                </Form.Group>
              </div>

              <div className="mt-3">
                {attachments.length ? (
                  <div className="ocp-table">
                    <Table responsive className="mb-0 align-middle">
                      <thead>
                        <tr>
                          <th>File</th>
                          <th>Uploaded</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {attachments.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <div className="fw-semibold">{a.file_name}</div>
                              <div className="small ocp-muted">{a.mime_type ?? '—'}</div>
                            </td>
                            <td className="small">{fmtDateTime(a.created_at)}</td>
                            <td className="text-end">
                              <Button
                                variant="outline-secondary"
                                className="rounded-pill"
                                size="sm"
                                onClick={() => openAttachment(a)}
                                disabled={busy}
                              >
                                Open
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-muted">No attachments.</div>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={4}>
          <Card className="ocp-card mb-3">
            <Card.Body>
              <div className="fw-semibold">Workflow steps</div>
              <div className="small ocp-muted">Full trace + timing</div>

              <div className="mt-3 ocp-timeline">
                {steps.map((s) => (
                  <div key={s.id} className="ocp-timeline-item">
                    <div className="ocp-timeline-dot" />
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="ocp-timeline-title">
                        Step {s.step_no} • Dept {s.department_id.slice(0, 8)}
                      </div>
                      <div>
                        <StepStatusBadge status={s.status} />
                      </div>
                    </div>
                    <div className="ocp-timeline-meta">
                      Assigned: {s.assignee_name ?? 'Unassigned'} • Created {fmtFromNow(s.created_at)}
                    </div>
                    {s.started_at && <div className="small ocp-muted">Started: {fmtDateTime(s.started_at)}</div>}
                    {s.completed_at && <div className="small ocp-muted">Completed: {fmtDateTime(s.completed_at)}</div>}
                    {s.approved_at && <div className="small ocp-muted">Approved: {fmtDateTime(s.approved_at)}</div>}
                    {s.returned_at && <div className="small text-danger">Returned: {fmtDateTime(s.returned_at)}</div>}
                    {s.return_reason && <div className="small text-danger">Reason: {s.return_reason}</div>}
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>

          <Card className="ocp-card">
            <Card.Body>
              <div className="fw-semibold">Recent events</div>
              <div className="small ocp-muted">System log for this request</div>

              <div className="mt-3">
                {events.length ? (
                  <div className="ocp-table">
                    <Table responsive className="mb-0 align-middle">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Event</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.slice(0, 20).map((e) => (
                          <tr key={e.id}>
                            <td className="small">{fmtDateTime(e.created_at)}</td>
                            <td>
                              <div className="fw-semibold small text-uppercase">{e.event_type}</div>
                              <div className="small ocp-muted">{e.message}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-muted">No events.</div>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Complete modal */}
      <Modal show={showComplete} onHide={() => setShowComplete(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Mark step as done</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Completion notes (optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="What was done, what to check, any links or files…"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowComplete(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="success" className="rounded-pill" onClick={() => doComplete()} disabled={busy}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Submit for approval'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Approve / forward modal */}
      <Modal show={showApprove} onHide={() => setShowApprove(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Approve & route</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="info">
            Leave <strong>Next department</strong> empty to close the request after approval.
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label>Next department (optional)</Form.Label>
            <Form.Select value={nextDeptId} onChange={(e) => setNextDeptId(e.target.value)}>
              <option value="">Close request</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Form.Select>
            <div className="small ocp-muted mt-2">
              Managers can route to other departments, but cannot assign to their employees.
            </div>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Next assignee (optional)</Form.Label>
            <Form.Select
              value={nextAssigneeId}
              onChange={(e) => setNextAssigneeId(e.target.value)}
              disabled={!canPickNextAssignee || !nextDeptId}
            >
              <option value="">{canPickNextAssignee ? 'Unassigned' : 'Only Admin/CEO or same-dept manager can assign'}</option>
              {nextPeople.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group>
            <Form.Label>Approval notes (optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              placeholder="Approval note / conditions / handoff instructions…"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowApprove(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="success" className="rounded-pill" onClick={() => doApprove()} disabled={busy}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Approve'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Return modal */}
      <Modal show={showReturn} onHide={() => setShowReturn(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Return with reason</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            The receiving department can send the workflow backward with mandatory notes. This is logged.
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label>Return reason (required)</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="What is missing? What must be fixed before resubmission?"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Return to department</Form.Label>
            <Form.Select value={returnDeptId} onChange={(e) => setReturnDeptId(e.target.value)}>
              <option value="">Default (previous)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group>
            <Form.Label>Return to assignee (optional)</Form.Label>
            <Form.Select
              value={returnAssigneeId}
              onChange={(e) => setReturnAssigneeId(e.target.value)}
              disabled={!canPickReturnAssignee || !returnDeptId}
            >
              <option value="">{canPickReturnAssignee ? 'Unassigned' : 'Only Admin/CEO or same-dept manager can assign'}</option>
              {returnPeople.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="rounded-pill" onClick={() => setShowReturn(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="rounded-pill"
            onClick={() => doReturn()}
            disabled={busy || returnReason.trim().length < 3}
          >
            {busy ? <Spinner size="sm" animation="border" /> : 'Return'}
          </Button>
        </Modal.Footer>
      </Modal>

      {busy && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 2000 }}>
          <div className="ocp-card p-3 d-flex align-items-center gap-2">
            <Spinner size="sm" animation="border" />
            <div className="small">Working…</div>
          </div>
        </div>
      )}
    </div>
  )
}
