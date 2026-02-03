-- ============================================================
-- 1) Strict request visibility rules (multi-tenant safe)
-- ============================================================
-- Employee: ONLY requests currently assigned to them (current step assignee)
-- Manager: requests they initiated OR requests currently in their department (current step dept)
-- Admin/CEO: company-wide
-- System admin: all
--
-- Also: cross-company safety: require request.company_id == user's profile.company_id
-- ============================================================

create or replace function public.can_select_request(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req_company uuid;
  v_requester uuid;
  v_current_step uuid;

  v_step_dept uuid;
  v_step_assignee uuid;

  v_my_company uuid;
  v_role public.role_type;
  v_my_dept uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- System admin sees all
  if public.is_system_admin() then
    return true;
  end if;

  -- User's company (single-company model)
  select p.company_id into v_my_company
  from public.profiles p
  where p.user_id = auth.uid();

  if v_my_company is null then
    return false;
  end if;

  -- Request core
  select r.company_id, r.requester_user_id, r.current_step_id
    into v_req_company, v_requester, v_current_step
  from public.requests r
  where r.id = p_request_id;

  if v_req_company is null then
    return false;
  end if;

  -- Cross-company isolation (hard stop)
  if v_req_company <> v_my_company then
    return false;
  end if;

  -- Role in this company
  v_role := public.my_role(v_req_company);

  -- Non-members see nothing
  if v_role is null then
    return false;
  end if;

  -- Admin/CEO see all in their company
  if v_role in ('admin'::public.role_type, 'ceo'::public.role_type) then
    return true;
  end if;

  -- Current step details
  if v_current_step is not null then
    select s.department_id, s.assigned_to
      into v_step_dept, v_step_assignee
    from public.request_steps s
    where s.id = v_current_step;
  else
    v_step_dept := null;
    v_step_assignee := null;
  end if;

  -- Manager: initiated OR currently in their dept
  if v_role = 'manager'::public.role_type then
    v_my_dept := public.my_department(v_req_company);

    if v_requester = auth.uid() then
      return true;
    end if;

    if v_my_dept is not null and v_step_dept = v_my_dept then
      return true;
    end if;

    return false;
  end if;

  -- Employee: ONLY current assignee
  if v_role = 'employee'::public.role_type then
    return v_step_assignee = auth.uid();
  end if;

  return false;
end;
$$;

grant execute on function public.can_select_request(uuid) to authenticated;

-- ============================================================
-- 2) Recreate views to enforce visibility even if RLS is bypassed
-- ============================================================

-- v_requests_current (used by Dashboard/Tasks/TaskDetail)
create or replace view public.v_requests_current as
select
  r.id,
  r.company_id,
  r.reference_code,
  r.title,
  r.description,
  r.request_type_id,
  rt.name as request_type_name,
  r.priority,
  r.status as request_status,
  r.workflow_status,
  r.amount,
  r.currency,
  r.cost_center,
  r.project_code,
  r.external_ref,
  r.category,
  r.risk_level,
  r.requester_user_id,
  r.requester_name as requester_name,
  r.origin_department_id,
  od.name as origin_department_name,
  r.due_at,
  r.created_at,
  r.updated_at,
  r.closed_at,
  r.current_step_id,
  s.step_no as current_step_no,
  s.department_id as current_department_id,
  d.name as current_department_name,
  s.assigned_to as current_assignee_id,
  s.assignee_name as current_assignee_name,
  s.status as current_step_status,
  s.status_notes as current_step_status_notes,
  s.created_at as current_step_created_at,
  s.started_at as current_step_started_at,
  s.completed_at as current_step_completed_at,
  s.due_at as current_step_due_at,
  round(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0, 2) as current_step_age_hours,
  round(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 86400.0, 2) as current_step_age_days,
  round(extract(epoch from (now() - r.created_at)) / 3600.0, 2) as request_age_hours,
  round(extract(epoch from (now() - r.created_at)) / 86400.0, 2) as request_age_days,
  case when s.due_at is null then null else round(extract(epoch from (s.due_at - now())) / 3600.0, 2) end as current_step_hours_to_due,
  case when s.due_at is null then false else (now() > s.due_at) end as current_step_is_overdue
from public.requests r
left join public.request_steps s on s.id = r.current_step_id
left join public.request_types rt on rt.id = r.request_type_id
left join public.departments od on od.id = r.origin_department_id
left join public.departments d on d.id = s.department_id
where public.can_select_request(r.id);

grant select on public.v_requests_current to authenticated;

-- v_sla_open_steps (used by SLA dashboard)
create or replace view public.v_sla_open_steps as
select
  s.id as step_id,
  s.company_id,
  s.request_id,
  r.reference_code,
  r.title,
  r.request_type_id,
  rt.name as request_type_name,
  r.workflow_status,
  r.priority,
  s.step_no,
  s.department_id,
  d.name as department_name,
  s.assigned_to,
  s.assignee_name,
  s.status as step_status,
  s.due_at,
  round(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0, 2) as step_age_hours,
  case when s.due_at is null then null else round(extract(epoch from (s.due_at - now())) / 3600.0, 2) end as hours_to_due,
  case when s.due_at is null then false else (now() > s.due_at) end as is_overdue
from public.request_steps s
join public.requests r on r.id = s.request_id
left join public.request_types rt on rt.id = r.request_type_id
left join public.departments d on d.id = s.department_id
where r.status = 'open'
  and s.status in ('queued','in_progress','done_pending_approval','on_hold','info_required','in_review')
  and public.can_select_request(r.id);

grant select on public.v_sla_open_steps to authenticated;

-- v_department_employee_workload (manager view) - restrict to manager-of-dept or admin/ceo (or system admin)
create or replace view public.v_department_employee_workload as
select
  p.company_id,
  p.department_id,
  d.name as department_name,
  p.user_id,
  p.full_name,
  p.email,
  p.job_title,
  count(*) filter (where s.status in ('queued','in_progress','done_pending_approval','info_required','in_review')) as open_steps,
  count(*) filter (where s.status = 'in_progress') as in_progress_steps,
  round(
    avg(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0)
      filter (where s.status in ('queued','in_progress','done_pending_approval','info_required','in_review')),
    2
  ) as avg_step_age_hours
from public.profiles p
join public.departments d on d.id = p.department_id
left join public.request_steps s
  on s.assigned_to = p.user_id
 and s.company_id = p.company_id
 and s.department_id = p.department_id
 and s.status in ('queued','in_progress','done_pending_approval','info_required','in_review')
where
  public.is_system_admin()
  or public.is_admin_or_ceo(p.company_id)
  or public.is_manager_of_department(p.company_id, p.department_id)
group by p.company_id, p.department_id, d.name, p.user_id, p.full_name, p.email, p.job_title;

grant select on public.v_department_employee_workload to authenticated;

-- ============================================================
-- 3) Prevent step status regression (fixes "done -> in_progress" after offboarding)
-- ============================================================
create or replace function public.prevent_step_status_regression()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- Once pending approval / approved / returned, never allow backward to queued/in_progress
    if old.status = 'done_pending_approval' and new.status in ('queued','in_progress') then
      new.status := old.status;
    elsif old.status = 'approved' and new.status in ('queued','in_progress','in_review') then
      new.status := old.status;
    elsif old.status = 'returned' and new.status in ('queued','in_progress','in_review') then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_step_status_regression on public.request_steps;
create trigger trg_prevent_step_status_regression
before update of status on public.request_steps
for each row execute function public.prevent_step_status_regression();
