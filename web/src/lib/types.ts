export type AppRole = 'admin' | 'ceo' | 'manager' | 'employee'

export type RequestStatus = 'open' | 'closed' | 'rejected' | 'archived'
export type StepStatus =
  | 'queued'
  | 'in_progress'
  | 'done_pending_approval'
  | 'approved'
  | 'returned'
  | 'rejected'
  | 'canceled'

export interface MyContextRow {
  user_id: string
  company_id: string
  full_name: string
  email: string
  branch_id: string | null
  department_id: string | null
  role: AppRole
}

export interface RequestCurrentRow {
  id: string
  company_id: string
  reference_code: string
  title: string
  description: string | null
  request_type_id: string
  request_type_name: string | null
  priority: number
  request_status: RequestStatus
  requester_user_id: string
  requester_name: string | null
  origin_department_id: string | null
  origin_department_name: string | null
  due_at: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  current_step_id: string | null
  current_step_no: number | null
  current_department_id: string | null
  current_department_name: string | null
  current_assignee_id: string | null
  current_assignee_name: string | null
  current_step_status: StepStatus | null
  current_step_created_at: string | null
  current_step_started_at: string | null
  current_step_completed_at: string | null
  current_step_age_hours: number | null
  current_step_age_days: number | null
  request_age_hours: number | null
  request_age_days: number | null
}

export interface DepartmentEmployeeWorkloadRow {
  company_id: string
  department_id: string | null
  department_name: string | null
  user_id: string
  full_name: string
  email: string
  job_title: string | null
  open_steps: number
  in_progress_steps: number
  avg_step_age_hours: number | null
}

export interface DepartmentRow {
  id: string
  company_id: string
  branch_id: string | null
  name: string
  code: string | null
}

export interface RequestTypeRow {
  id: string
  company_id: string
  name: string
  description: string | null
  default_priority: number
  active: boolean
}

export interface RequestStepRow {
  id: string
  request_id: string
  company_id: string
  step_no: number
  from_department_id: string | null
  department_id: string
  assigned_to: string | null
  assignee_name: string | null
  status: StepStatus
  created_by: string | null
  started_at: string | null
  completed_at: string | null
  completion_notes: string | null
  approved_at: string | null
  approved_by: string | null
  auto_approved: boolean
  approval_notes: string | null
  returned_at: string | null
  return_reason: string | null
  related_step_id: string | null
  due_at: string | null
  created_at: string
}

export interface RequestEventRow {
  id: string
  request_id: string
  step_id: string | null
  company_id: string
  event_type: string
  message: string
  created_by: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

export interface CommentRow {
  id: string
  request_id: string
  step_id: string | null
  company_id: string
  user_id: string
  body: string
  created_at: string
}

export interface AttachmentRow {
  id: string
  request_id: string
  step_id: string | null
  company_id: string
  uploaded_by: string
  storage_bucket: string
  storage_path: string
  file_name: string
  mime_type: string | null
  byte_size: number | null
  created_at: string
}

export interface AuditLogRow {
  id: number
  company_id: string
  table_name: string
  action: string
  record_pk: string
  request_id: string | null
  step_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_by: string | null
  changed_at: string
}

export interface ProfileRow {
  user_id: string
  company_id: string
  full_name: string
  email: string
  branch_id: string | null
  department_id: string | null
  job_title: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MembershipRow {
  id: string
  company_id: string
  user_id: string
  role: AppRole
  branch_id: string | null
  department_id: string | null
  created_at: string
  updated_at: string
}
