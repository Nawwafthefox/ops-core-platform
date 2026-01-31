import React from 'react'
import { Badge } from 'react-bootstrap'
import type { RequestStatus, StepStatus } from '../lib/types'

export function StepStatusBadge({ status }: { status: StepStatus | null | undefined }) {
  if (!status) return <span className="text-muted">—</span>

  const v =
    status === 'queued'
      ? 'secondary'
      : status === 'in_progress'
        ? 'primary'
        : status === 'done_pending_approval'
          ? 'warning'
          : status === 'approved'
            ? 'success'
            : status === 'returned'
              ? 'danger'
              : status === 'rejected'
                ? 'danger'
                : 'secondary'

  const label =
    status === 'done_pending_approval' ? 'pending approval' : status.replaceAll('_', ' ')

  return (
    <Badge bg={v} className="rounded-pill px-3 py-2 text-uppercase" style={{ fontSize: 11 }}>
      {label}
    </Badge>
  )
}

export function RequestStatusBadge({ status }: { status: RequestStatus | null | undefined }) {
  if (!status) return <span className="text-muted">—</span>

  const v =
    status === 'open'
      ? 'primary'
      : status === 'closed'
        ? 'success'
        : status === 'rejected'
          ? 'danger'
          : 'secondary'

  return (
    <Badge bg={v} className="rounded-pill px-3 py-2 text-uppercase" style={{ fontSize: 11 }}>
      {status}
    </Badge>
  )
}
