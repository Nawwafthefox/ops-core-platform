begin;

-- ---------------------------------------------------------------------
-- 1) Workflow lifecycle status (request-level)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_status'
  ) then
    create type public.workflow_status as enum (
      'draft',
      'submitted',
      'manager_approved',
      'in_review',
      'in_progress',
      'on_hold',
      'info_required',
      'completed',
      'closed',
      'rejected'
    );
  end if;
end $$;

alter table public.requests
  add column if not exists workflow_status public.workflow_status not null default 'submitted',
  add column if not exists amount numeric null,
  add column if not exists currency text null,
  add column if not exists cost_center text null,
  add column if not exists project_code text null,
  add column if not exists external_ref text null,
  add column if not exists category text null,
  add column if not exists risk_level text null;

-- Backfill sensible workflow_status for existing rows
update public.requests
set workflow_status = (case
  when status = 'closed' then 'closed'
  when status = 'rejected' then 'rejected'
  when current_step_id is null then 'draft'
  else 'in_progress'
end)::public.workflow_status
where workflow_status is null;

-- ---------------------------------------------------------------------
-- 2) Request Types: optional machine code + workflow config (JSON)
-- ---------------------------------------------------------------------
alter table public.request_types
  add column if not exists code text null,
  add column if not exists workflow_config jsonb not null default '{}'::jsonb;

create unique index if not exists uniq_request_types_company_code
  on public.request_types(company_id, code)
  where code is not null;

-- ---------------------------------------------------------------------
-- 3) Step-level enhancements: status notes + status_updated_at
-- ---------------------------------------------------------------------
alter table public.request_steps
  add column if not exists status_notes text null,
  add column if not exists status_updated_at timestamptz not null default now();

create or replace function public.set_step_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      new.status_updated_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_steps_status_updated_at on public.request_steps;
create trigger trg_steps_status_updated_at
before update on public.request_steps
for each row execute function public.set_step_status_updated_at();

-- ---------------------------------------------------------------------
-- 4) SLA configuration per (department, request_type)
-- ---------------------------------------------------------------------
alter table public.department_request_type_settings
  add column if not exists sla_hours integer not null default 48,
  add column if not exists sla_warn_hours integer not null default 6,
  add column if not exists sla_escalate_hours integer not null default 24;

-- Helper: compute due_at based on SLA settings
create or replace function public.compute_step_due_at(
  p_company_id uuid,
  p_department_id uuid,
  p_request_type_id uuid,
  p_fallback_due_at timestamptz default null
) returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hours integer;
  v_due timestamptz;
begin
  if p_fallback_due_at is not null then
    return p_fallback_due_at;
  end if;

  select s.sla_hours into v_hours
  from public.department_request_type_settings s
  where s.company_id = p_company_id
    and s.department_id = p_department_id
    and s.request_type_id = p_request_type_id;

  if v_hours is null then
    return null;
  end if;

  v_due := now() + make_interval(hours => v_hours);
  return v_due;
end;
$$;

grant execute on function public.compute_step_due_at(uuid,uuid,uuid,timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Sync request.workflow_status from request.status + current step
-- ---------------------------------------------------------------------
create or replace function public.sync_request_workflow_status(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req_status public.request_status;
  v_step_status public.step_status;
  v_current_step uuid;
  v_new public.workflow_status;
begin
  select status, current_step_id into v_req_status, v_current_step
  from public.requests
  where id = p_request_id;

  if v_req_status is null then
    return;
  end if;

  if v_req_status = 'closed' then
    v_new := 'closed';
  elsif v_req_status = 'rejected' then
    v_new := 'rejected';
  else
    if v_current_step is null then
      v_new := 'draft';
    else
      select status into v_step_status
      from public.request_steps
      where id = v_current_step;

      v_new := case
        when v_step_status = 'queued' then 'submitted'
        when v_step_status = 'in_review' then 'in_review'
        when v_step_status = 'in_progress' then 'in_progress'
        when v_step_status = 'done_pending_approval' then 'in_review'
        when v_step_status = 'info_required' then 'info_required'
        when v_step_status = 'on_hold' then 'on_hold'
        else 'in_progress'
      end;
    end if;
  end if;

  update public.requests
  set workflow_status = v_new,
      updated_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function public.sync_request_workflow_status(uuid) to authenticated;

create or replace function public.trg_sync_request_workflow_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_request_workflow_status(coalesce(new.request_id, old.request_id));
  return null;
end;
$$;

drop trigger if exists trg_sync_request_workflow_status on public.request_steps;
create trigger trg_sync_request_workflow_status
after insert or update of status, assigned_to, due_at on public.request_steps
for each row execute function public.trg_sync_request_workflow_status();

-- ---------------------------------------------------------------------
-- 6) Upgrade core RPCs to:
--    - store extended request fields
--    - compute due_at from SLA when not provided
--    - set workflow_status appropriately
-- ---------------------------------------------------------------------

-- rpc_create_request: add optional business fields + draft support
create or replace function public.rpc_create_request(
  p_request_type_id uuid,
  p_title text,
  p_description text,
  p_target_department_id uuid,
  p_target_assignee_id uuid default null,
  p_priority smallint default null,
  p_due_at timestamptz default null,
  p_amount numeric default null,
  p_currency text default null,
  p_cost_center text default null,
  p_project_code text default null,
  p_external_ref text default null,
  p_category text default null,
  p_risk_level text default null,
  p_save_as_draft boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_ref text;
  v_request_id uuid;
  v_step_id uuid;
  v_origin_dept uuid;
  v_origin_branch uuid;
  v_priority smallint;
  v_requester_name text;
  v_assignee_name text;
  v_assignee_email text;
  v_due timestamptz;
  v_wf public.workflow_status;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select rt.company_id into v_company
  from public.request_types rt
  where rt.id = p_request_type_id and rt.active = true;

  if v_company is null then
    raise exception 'Invalid request type';
  end if;

  if not public.is_company_member(v_company) then
    raise exception 'Not a company member';
  end if;

  select p.department_id, p.branch_id, p.full_name
    into v_origin_dept, v_origin_branch, v_requester_name
  from public.profiles p
  where p.user_id = auth.uid();

  v_ref := public.generate_request_reference();
  v_priority := coalesce(p_priority, (select default_priority from public.request_types where id = p_request_type_id));

  v_due := public.compute_step_due_at(v_company, p_target_department_id, p_request_type_id, p_due_at);
  v_wf := case when p_save_as_draft then 'draft' else 'submitted' end;

  insert into public.requests(
    company_id,
    reference_code,
    title,
    description,
    request_type_id,
    priority,
    requester_user_id,
    requester_name,
    origin_department_id,
    origin_branch_id,
    due_at,
    workflow_status,
    amount,
    currency,
    cost_center,
    project_code,
    external_ref,
    category,
    risk_level
  ) values (
    v_company,
    v_ref,
    p_title,
    p_description,
    p_request_type_id,
    v_priority,
    auth.uid(),
    v_requester_name,
    v_origin_dept,
    v_origin_branch,
    v_due,
    v_wf,
    p_amount,
    p_currency,
    p_cost_center,
    p_project_code,
    p_external_ref,
    p_category,
    p_risk_level
  ) returning id into v_request_id;

  -- Draft requests are not routed yet
  if p_save_as_draft then
    return v_request_id;
  end if;

  if p_target_assignee_id is not null then
    select full_name, email into v_assignee_name, v_assignee_email
    from public.profiles where user_id = p_target_assignee_id;
  end if;

  insert into public.request_steps(
    request_id,
    company_id,
    step_no,
    from_department_id,
    department_id,
    assigned_to,
    assignee_name,
    status,
    created_by,
    due_at
  ) values (
    v_request_id,
    v_company,
    1,
    v_origin_dept,
    p_target_department_id,
    p_target_assignee_id,
    v_assignee_name,
    'queued',
    auth.uid(),
    v_due
  ) returning id into v_step_id;

  update public.requests
  set current_step_id = v_step_id,
      workflow_status = 'in_progress'
  where id = v_request_id;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (
    v_request_id,
    v_step_id,
    v_company,
    'created',
    'Request created and routed to department',
    auth.uid(),
    jsonb_build_object('target_department_id', p_target_department_id, 'assigned_to', p_target_assignee_id)
  );

  -- Notify assignee if provided
  if p_target_assignee_id is not null and v_assignee_email is not null then
    perform public.enqueue_email(
      v_company,
      'step_assigned',
      p_target_assignee_id,
      v_assignee_email,
      'New task assigned: ' || v_ref,
      'You have been assigned a new task (' || v_ref || '): ' || p_title,
      jsonb_build_object('request_id', v_request_id, 'step_id', v_step_id)
    );
  end if;

  -- Notify managers of target department
  insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
  select
    v_company,
    'step_routed_to_department',
    dm.user_id,
    dm.email,
    'New task received: ' || v_ref,
    'A new task (' || v_ref || ') has been routed to your department.',
    jsonb_build_object('request_id', v_request_id, 'step_id', v_step_id)
  from public.department_manager_emails(v_company, p_target_department_id) dm;

  return v_request_id;
end;
$$;

-- Approve step: compute SLA due_at for the next step
create or replace function public.rpc_approve_step(
  p_step_id uuid,
  p_next_department_id uuid default null,
  p_next_assignee_id uuid default null,
  p_approval_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_dept uuid;
  v_req uuid;
  v_step_no integer;
  v_req_status public.request_status;
  v_next_step_no integer;
  v_next_step_id uuid;
  v_ref text;
  v_title text;
  v_next_assignee_name text;
  v_next_assignee_email text;
  v_role public.role_type;
  v_request_type uuid;
  v_next_due timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select s.company_id, s.department_id, s.request_id, s.step_no
    into v_company, v_dept, v_req, v_step_no
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  v_role := public.my_role(v_company);

  if not (public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept) or v_role = 'manager') then
    raise exception 'Not allowed to approve step';
  end if;

  -- If role is manager, enforce department match
  if v_role = 'manager' and not public.is_manager_of_department(v_company, v_dept) then
    raise exception 'Manager can only approve within their department';
  end if;

  update public.request_steps
  set status = 'approved',
      approved_at = now(),
      approved_by = case when public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept) then auth.uid() else null end,
      auto_approved = case when p_approval_notes like '[AUTO]%' then true else auto_approved end,
      approval_notes = p_approval_notes
  where id = p_step_id
    and status in ('done_pending_approval','approved');

  select reference_code, title, status, request_type_id
    into v_ref, v_title, v_req_status, v_request_type
  from public.requests where id = v_req;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (
    v_req,
    p_step_id,
    v_company,
    'approved',
    'Step approved',
    auth.uid(),
    jsonb_build_object('next_department_id', p_next_department_id, 'next_assignee_id', p_next_assignee_id)
  );

  if p_next_department_id is not null then
    select coalesce(max(step_no),0) + 1 into v_next_step_no
    from public.request_steps where request_id = v_req;

    if p_next_assignee_id is not null then
      select full_name, email into v_next_assignee_name, v_next_assignee_email
      from public.profiles where user_id = p_next_assignee_id;
    end if;

    v_next_due := public.compute_step_due_at(v_company, p_next_department_id, v_request_type, null);

    insert into public.request_steps(
      request_id,
      company_id,
      step_no,
      from_department_id,
      department_id,
      assigned_to,
      assignee_name,
      status,
      created_by,
      due_at,
      related_step_id
    ) values (
      v_req,
      v_company,
      v_next_step_no,
      v_dept,
      p_next_department_id,
      p_next_assignee_id,
      v_next_assignee_name,
      'queued',
      auth.uid(),
      v_next_due,
      p_step_id
    ) returning id into v_next_step_id;

    update public.requests
    set current_step_id = v_next_step_id,
        status = 'open',
        closed_at = null,
        due_at = coalesce(v_next_due, due_at)
    where id = v_req;

    insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
    values (
      v_req,
      v_next_step_id,
      v_company,
      'forwarded',
      'Forwarded to next department',
      auth.uid(),
      jsonb_build_object('from_department_id', v_dept, 'to_department_id', p_next_department_id)
    );

    -- Notify next assignee if specified
    if p_next_assignee_id is not null and v_next_assignee_email is not null then
      perform public.enqueue_email(
        v_company,
        'step_assigned',
        p_next_assignee_id,
        v_next_assignee_email,
        'Task assigned: ' || v_ref,
        'You have been assigned task (' || v_ref || '): ' || v_title,
        jsonb_build_object('request_id', v_req, 'step_id', v_next_step_id)
      );
    end if;

    -- Notify managers of next department
    insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
    select
      v_company,
      'step_received',
      dm.user_id,
      dm.email,
      'New task received: ' || v_ref,
      'A task (' || v_ref || ') has been forwarded to your department.',
      jsonb_build_object('request_id', v_req, 'step_id', v_next_step_id)
    from public.department_manager_emails(v_company, p_next_department_id) dm;

  else
    update public.requests
    set status = 'closed',
        closed_at = now(),
        workflow_status = 'closed'
    where id = v_req;

    insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by)
    values (v_req, p_step_id, v_company, 'closed', 'Request closed', auth.uid());

    -- Notify requester
    insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
    select
      v_company,
      'request_closed',
      p.user_id,
      p.email,
      'Request closed: ' || v_ref,
      'Your request (' || v_ref || ') has been completed and closed.',
      jsonb_build_object('request_id', v_req, 'step_id', p_step_id)
    from public.profiles p
    where p.user_id = (select requester_user_id from public.requests where id = v_req);

  end if;
end;
$$;

-- Return step: compute SLA due_at for the returned-to department
create or replace function public.rpc_return_step(
  p_step_id uuid,
  p_reason text,
  p_return_to_department_id uuid default null,
  p_return_to_assignee_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_req uuid;
  v_dept uuid;
  v_prev_dept uuid;
  v_return_dept uuid;
  v_next_step_no integer;
  v_new_step_id uuid;
  v_ref text;
  v_title text;
  v_return_assignee_name text;
  v_return_assignee_email text;
  v_role public.role_type;
  v_request_type uuid;
  v_due timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Return reason is required';
  end if;

  select s.company_id, s.request_id, s.department_id, s.from_department_id
    into v_company, v_req, v_dept, v_prev_dept
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  v_role := public.my_role(v_company);

  if v_role = 'manager' and not public.is_manager_of_department(v_company, v_dept) then
    raise exception 'Manager can only return within their department';
  end if;

  if not (public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept) or v_role='manager') then
    raise exception 'Not allowed to return step';
  end if;

  v_return_dept := coalesce(p_return_to_department_id, v_prev_dept);
  if v_return_dept is null then
    raise exception 'No previous department to return to';
  end if;

  if p_return_to_assignee_id is not null then
    select full_name, email into v_return_assignee_name, v_return_assignee_email
    from public.profiles where user_id = p_return_to_assignee_id;
  end if;

  update public.request_steps
  set status = 'returned',
      returned_at = now(),
      return_reason = p_reason
  where id = p_step_id;

  select request_type_id, reference_code, title
    into v_request_type, v_ref, v_title
  from public.requests where id = v_req;

  v_due := public.compute_step_due_at(v_company, v_return_dept, v_request_type, null);

  select coalesce(max(step_no),0) + 1 into v_next_step_no
  from public.request_steps where request_id = v_req;

  insert into public.request_steps(
    request_id,
    company_id,
    step_no,
    from_department_id,
    department_id,
    assigned_to,
    assignee_name,
    status,
    created_by,
    related_step_id,
    due_at
  ) values (
    v_req,
    v_company,
    v_next_step_no,
    v_dept,
    v_return_dept,
    p_return_to_assignee_id,
    v_return_assignee_name,
    'queued',
    auth.uid(),
    p_step_id,
    v_due
  ) returning id into v_new_step_id;

  update public.requests
  set current_step_id = v_new_step_id,
      status = 'open',
      closed_at = null,
      due_at = coalesce(v_due, due_at)
  where id = v_req;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (
    v_req,
    v_new_step_id,
    v_company,
    'returned',
    'Returned to previous department',
    auth.uid(),
    jsonb_build_object('from_department_id', v_dept, 'to_department_id', v_return_dept, 'reason', p_reason)
  );

  -- Notify managers of return department
  insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
  select
    v_company,
    'step_returned',
    dm.user_id,
    dm.email,
    'Task returned: ' || v_ref,
    'A task (' || v_ref || ') has been returned to your department. Reason: ' || p_reason,
    jsonb_build_object('request_id', v_req, 'step_id', v_new_step_id, 'reason', p_reason)
  from public.department_manager_emails(v_company, v_return_dept) dm;

  -- Notify return assignee if specified
  if p_return_to_assignee_id is not null and v_return_assignee_email is not null then
    perform public.enqueue_email(
      v_company,
      'step_returned',
      p_return_to_assignee_id,
      v_return_assignee_email,
      'Task returned: ' || v_ref,
      'A task (' || v_ref || ') has been returned to you. Reason: ' || p_reason,
      jsonb_build_object('request_id', v_req, 'step_id', v_new_step_id, 'reason', p_reason)
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) New RPCs: On Hold / Info Required / Resume
-- ---------------------------------------------------------------------

create or replace function public.rpc_step_set_on_hold(
  p_step_id uuid,
  p_notes text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_req uuid;
  v_dept uuid;
  v_assignee uuid;
  v_ref text;
  v_requester uuid;
  v_requester_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_notes is null or length(trim(p_notes)) < 3 then raise exception 'Notes are required'; end if;

  select s.company_id, s.request_id, s.department_id, s.assigned_to
    into v_company, v_req, v_dept, v_assignee
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  if not (auth.uid() = v_assignee or public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept)) then
    raise exception 'Not allowed';
  end if;

  update public.request_steps
  set status = 'on_hold',
      status_notes = p_notes
  where id = p_step_id;

  select reference_code, requester_user_id
    into v_ref, v_requester
  from public.requests where id = v_req;

  select email into v_requester_email
  from public.profiles where user_id = v_requester;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (v_req, p_step_id, v_company, 'on_hold', 'Step put on hold', auth.uid(), jsonb_build_object('notes', p_notes));

  -- Notify requester (visibility)
  if v_requester_email is not null then
    perform public.enqueue_email(
      v_company,
      'step_on_hold',
      v_requester,
      v_requester_email,
      'On hold: ' || v_ref,
      'Your request (' || v_ref || ') is on hold. Notes: ' || p_notes,
      jsonb_build_object('request_id', v_req, 'step_id', p_step_id)
    );
  end if;
end;
$$;

grant execute on function public.rpc_step_set_on_hold(uuid,text) to authenticated;

create or replace function public.rpc_step_set_info_required(
  p_step_id uuid,
  p_notes text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_req uuid;
  v_dept uuid;
  v_assignee uuid;
  v_ref text;
  v_requester uuid;
  v_requester_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_notes is null or length(trim(p_notes)) < 3 then raise exception 'Notes are required'; end if;

  select s.company_id, s.request_id, s.department_id, s.assigned_to
    into v_company, v_req, v_dept, v_assignee
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  if not (auth.uid() = v_assignee or public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept)) then
    raise exception 'Not allowed';
  end if;

  update public.request_steps
  set status = 'info_required',
      status_notes = p_notes
  where id = p_step_id;

  select reference_code, requester_user_id
    into v_ref, v_requester
  from public.requests where id = v_req;

  select email into v_requester_email
  from public.profiles where user_id = v_requester;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (v_req, p_step_id, v_company, 'info_required', 'Information required', auth.uid(), jsonb_build_object('notes', p_notes));

  -- Notify requester
  if v_requester_email is not null then
    perform public.enqueue_email(
      v_company,
      'info_required',
      v_requester,
      v_requester_email,
      'Info required: ' || v_ref,
      'More information is required for request (' || v_ref || '). Notes: ' || p_notes,
      jsonb_build_object('request_id', v_req, 'step_id', p_step_id)
    );
  end if;
end;
$$;

grant execute on function public.rpc_step_set_info_required(uuid,text) to authenticated;

create or replace function public.rpc_step_resume(
  p_step_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_dept uuid;
  v_assignee uuid;
  v_req uuid;
  v_prev_started timestamptz;
  v_new_status public.step_status;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select s.company_id, s.department_id, s.assigned_to, s.request_id, s.started_at
    into v_company, v_dept, v_assignee, v_req, v_prev_started
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  if not (auth.uid() = v_assignee or public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept)) then
    raise exception 'Not allowed';
  end if;

  v_new_status := case when v_prev_started is null then 'queued' else 'in_progress' end;

  update public.request_steps
  set status = v_new_status,
      status_notes = null
  where id = p_step_id
    and status in ('on_hold','info_required','in_review');

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by)
  values (v_req, p_step_id, v_company, 'resumed', 'Step resumed', auth.uid());
end;
$$;

grant execute on function public.rpc_step_resume(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Views for UI: extend v_requests_current + SLA monitoring
-- ---------------------------------------------------------------------

drop view if exists public.v_requests_current;

create view public.v_requests_current as
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
left join public.departments d on d.id = s.department_id;

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
  and s.status in ('queued','in_progress','done_pending_approval','on_hold','info_required','in_review');

-- Update workload view to include new open statuses
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
  round(avg(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0) filter (where s.status in ('queued','in_progress','done_pending_approval','info_required','in_review')), 2) as avg_step_age_hours
from public.profiles p
join public.departments d on d.id = p.department_id
left join public.request_steps s on s.assigned_to = p.user_id
  and s.company_id = p.company_id
  and s.status in ('queued','in_progress','done_pending_approval','info_required','in_review')
group by p.company_id, p.department_id, d.name, p.user_id, p.full_name, p.email, p.job_title;

-- ---------------------------------------------------------------------
-- 6) Governance scaffolding (Routing Matrix, Approval Matrix, Retention)
-- ---------------------------------------------------------------------

-- Routing rules: ordered rules that determine the next department based on
-- request metadata (amount, category, risk, etc.).
create table if not exists public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_type_id uuid not null references public.request_types(id) on delete cascade,
  sort_order integer not null default 1,
  condition jsonb not null,
  next_department_id uuid not null references public.departments(id),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists routing_rules_company_type_order_idx
  on public.routing_rules(company_id, request_type_id, sort_order);

-- Approval matrix rules: amount bands map to an approval chain.
-- approval_chain JSON example:
--   [{"role":"manager"},{"role":"finance_reviewer"},{"role":"ceo"}]
create table if not exists public.approval_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_type_id uuid not null references public.request_types(id) on delete cascade,
  min_amount numeric,
  max_amount numeric,
  currency text,
  approval_chain jsonb not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists approval_matrix_rules_company_type_idx
  on public.approval_matrix_rules(company_id, request_type_id);

-- Retention policies: define how long to keep artifacts before archiving.
create table if not exists public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  policy_code text not null,
  scope_table text not null,
  retention_days integer not null,
  action text not null default 'archive', -- archive | delete
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(company_id, policy_code)
);

commit;
