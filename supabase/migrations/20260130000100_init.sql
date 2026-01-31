
-- Operations Core Platform (MVP+) schema for Supabase
-- Includes: multi-tenant org, RBAC (admin/ceo/manager/employee), requests + multi-department workflow steps,
-- approvals (manual/auto), comments, attachments, audit log, email outbox.

begin;

-- Extensions (Supabase usually has these enabled, but keep idempotent)
create extension if not exists pgcrypto;


-- Safe UUID cast helper (returns NULL instead of throwing)
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;


-- ---------- Types ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'role_type') then
    create type public.role_type as enum ('admin','ceo','manager','employee');
  end if;
  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('open','closed','rejected','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'step_status') then
    create type public.step_status as enum ('queued','in_progress','done_pending_approval','approved','returned','rejected','canceled');
  end if;
  if not exists (select 1 from pg_type where typname = 'approval_mode') then
    create type public.approval_mode as enum ('manual','auto');
  end if;
end$$;

-- ---------- Utility: updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Core Org Tables ----------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  unique(company_id, name)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete set null,
  name text not null,
  code text null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  unique(company_id, name),
  unique(company_id, code)
);

-- App settings (only for local bootstrap / convenience)
create table if not exists public.app_settings (
  key text primary key,
  value text null,
  value_json jsonb null,
  updated_at timestamptz not null default now()
);

create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

-- Profiles linked to auth.users
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  email text not null,
  branch_id uuid null references public.branches(id) on delete set null,
  department_id uuid null references public.departments(id) on delete set null,
  job_title text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Memberships (RBAC + scope)
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role public.role_type not null default 'employee',
  branch_id uuid null references public.branches(id) on delete set null,
  department_id uuid null references public.departments(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  unique(company_id, user_id),
  constraint memberships_scope_check check (
    (role in ('employee','manager') and department_id is not null)
    or (role in ('admin','ceo') and department_id is null)
  )
);

create index if not exists idx_memberships_company_user on public.memberships(company_id, user_id);
create index if not exists idx_memberships_company_role on public.memberships(company_id, role);
create index if not exists idx_memberships_company_dept on public.memberships(company_id, department_id);

create trigger trg_memberships_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

-- ---------- Workflow Configuration ----------
create table if not exists public.request_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text null,
  default_priority smallint not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null,
  unique(company_id, name)
);

create index if not exists idx_request_types_company on public.request_types(company_id);

create table if not exists public.department_request_type_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  request_type_id uuid not null references public.request_types(id) on delete cascade,
  approval_mode public.approval_mode not null default 'manual',
  default_next_department_id uuid null references public.departments(id) on delete set null,
  auto_close boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(company_id, department_id, request_type_id)
);

create trigger trg_dept_rts_updated_at
before update on public.department_request_type_settings
for each row execute function public.set_updated_at();

-- ---------- Requests + Steps ----------
create sequence if not exists public.request_ref_seq;

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference_code text not null unique,
  title text not null,
  description text null,
  request_type_id uuid not null references public.request_types(id) on delete restrict,
  priority smallint not null default 3,
  requester_user_id uuid not null references public.profiles(user_id) on delete restrict,
  requester_name text not null,
  origin_branch_id uuid null references public.branches(id) on delete set null,
  origin_department_id uuid null references public.departments(id) on delete set null,
  status public.request_status not null default 'open',
  current_step_id uuid null,
  due_at timestamptz null,
  closed_at timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_requests_company_created on public.requests(company_id, created_at desc);
create index if not exists idx_requests_company_status on public.requests(company_id, status);
create index if not exists idx_requests_requester on public.requests(requester_user_id);

create trigger trg_requests_updated_at
before update on public.requests
for each row execute function public.set_updated_at();

create table if not exists public.request_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  step_no integer not null,
  from_department_id uuid null references public.departments(id) on delete set null,
  department_id uuid not null references public.departments(id) on delete restrict,
  assigned_to uuid null references public.profiles(user_id) on delete set null,
  assignee_name text null,
  status public.step_status not null default 'queued',
  created_by uuid null,
  started_at timestamptz null,
  completed_at timestamptz null,
  completion_notes text null,
  approved_at timestamptz null,
  approved_by uuid null references public.profiles(user_id) on delete set null,
  auto_approved boolean not null default false,
  approval_notes text null,
  returned_at timestamptz null,
  return_reason text null,
  related_step_id uuid null references public.request_steps(id) on delete set null,
  due_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_steps_request_stepno on public.request_steps(request_id, step_no);
create index if not exists idx_steps_company_dept_status on public.request_steps(company_id, department_id, status);
create index if not exists idx_steps_assigned_to on public.request_steps(assigned_to);
create index if not exists idx_steps_request on public.request_steps(request_id);

alter table public.requests
  add constraint fk_requests_current_step
  foreign key (current_step_id) references public.request_steps(id) deferrable initially deferred;

-- ---------- Collaboration ----------
create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  step_id uuid null references public.request_steps(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_request on public.request_comments(request_id, created_at);

create table if not exists public.request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  step_id uuid null references public.request_steps(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(user_id) on delete restrict,
  storage_bucket text not null default 'request-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text null,
  byte_size bigint null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_request on public.request_attachments(request_id, created_at);

create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  step_id uuid null references public.request_steps(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  message text not null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  metadata jsonb null
);

create index if not exists idx_events_request on public.request_events(request_id, created_at);

-- ---------- Email Outbox ----------
create table if not exists public.notification_outbox (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null default 'email',
  template text not null,
  to_user_id uuid null,
  to_email text not null,
  subject text not null,
  body text not null,
  payload jsonb null,
  status text not null default 'queued', -- queued | processing | sent | failed
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  sent_at timestamptz null,
  error text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_outbox_status_next on public.notification_outbox(status, next_attempt_at);
create index if not exists idx_outbox_company_created on public.notification_outbox(company_id, created_at desc);

-- ---------- Audit Log ----------
create table if not exists public.audit_log (
  id bigserial primary key,
  company_id uuid not null,
  table_name text not null,
  action text not null, -- INSERT/UPDATE/DELETE
  record_pk text not null,
  request_id uuid null,
  step_id uuid null,
  old_data jsonb null,
  new_data jsonb null,
  changed_by uuid null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_audit_company_time on public.audit_log(company_id, changed_at desc);
create index if not exists idx_audit_request on public.audit_log(request_id, changed_at desc);

-- Generic audit trigger
create or replace function public.audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_request uuid;
  v_step uuid;
  v_pk text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_old := null;
  elsif tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
  else
    v_new := null;
    v_old := to_jsonb(old);
  end if;

  -- Best-effort: pull company_id, request_id, step_id from row json if present
  v_company := coalesce((v_new->>'company_id')::uuid, (v_old->>'company_id')::uuid);
  v_request := coalesce((v_new->>'request_id')::uuid, (v_old->>'request_id')::uuid);
  v_step := coalesce((v_new->>'step_id')::uuid, (v_old->>'step_id')::uuid);

  if tg_table_name = 'requests' then
    v_request := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  end if;
  if tg_table_name = 'request_steps' then
    v_step := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  end if;

  v_pk := coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'key', v_old->>'key', v_new->>'id', v_old->>'id');
  if v_pk is null then
    v_pk := 'n/a';
  end if;

  insert into public.audit_log(company_id, table_name, action, record_pk, request_id, step_id, old_data, new_data, changed_by)
  values (v_company, tg_table_name, tg_op, v_pk, v_request, v_step, v_old, v_new, auth.uid());

  return coalesce(new, old);
end;
$$;

-- Attach audit triggers to key tables (minimal but useful)
drop trigger if exists trg_audit_requests on public.requests;
create trigger trg_audit_requests
after insert or update or delete on public.requests
for each row execute function public.audit_log_trigger();

drop trigger if exists trg_audit_steps on public.request_steps;
create trigger trg_audit_steps
after insert or update or delete on public.request_steps
for each row execute function public.audit_log_trigger();

drop trigger if exists trg_audit_comments on public.request_comments;
create trigger trg_audit_comments
after insert or update or delete on public.request_comments
for each row execute function public.audit_log_trigger();

drop trigger if exists trg_audit_memberships on public.memberships;
create trigger trg_audit_memberships
after insert or update or delete on public.memberships
for each row execute function public.audit_log_trigger();

-- ---------- RBAC Helpers ----------
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.my_role(p_company_id uuid)
returns public.role_type
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m.company_id = p_company_id and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.my_department(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.department_id
  from public.memberships m
  where m.company_id = p_company_id and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.my_branch(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.branch_id
  from public.memberships m
  where m.company_id = p_company_id and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(p_company_id) = 'admin';
$$;

create or replace function public.is_ceo(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(p_company_id) = 'ceo';
$$;

create or replace function public.is_admin_or_ceo(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(p_company_id) in ('admin','ceo');
$$;

create or replace function public.is_manager_of_department(p_company_id uuid, p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role(p_company_id) = 'manager'
     and public.my_department(p_company_id) = p_department_id;
$$;

-- Request access check (SELECT)
create or replace function public.can_select_request(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_origin_dept uuid;
  v_requester uuid;
  v_role public.role_type;
  v_my_dept uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  select r.company_id, r.origin_department_id, r.requester_user_id
    into v_company, v_origin_dept, v_requester
  from public.requests r
  where r.id = p_request_id;

  if v_company is null then
    return false;
  end if;

  v_role := public.my_role(v_company);

  -- Admin/CEO can see everything in company
  if v_role in ('admin','ceo') then
    return true;
  end if;

  -- Requester can see their own request
  if v_requester = auth.uid() then
    return true;
  end if;

  -- Assigned users on any step can see
  if exists (
    select 1 from public.request_steps s
    where s.request_id = p_request_id and s.assigned_to = auth.uid()
  ) then
    return true;
  end if;

  -- Managers can see requests that originate from their dept, and any requests routed to their dept
  if v_role = 'manager' then
    v_my_dept := public.my_department(v_company);

    if v_my_dept is not null and v_origin_dept = v_my_dept then
      return true;
    end if;

    if exists (
      select 1 from public.request_steps s
      where s.request_id = p_request_id and s.department_id = v_my_dept
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- Profile access check (SELECT) - avoids exposing all employees cross-department

create or replace function public.can_select_profile(p_company_id uuid, p_department_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.role_type;
  v_my_dept uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Everyone can see themselves
  if p_user_id = auth.uid() then
    return true;
  end if;

  v_role := public.my_role(p_company_id);

  -- Admin/CEO can see everyone in the company
  if v_role in ('admin','ceo') then
    return true;
  end if;

  -- Department managers can see employees within their own department only
  if v_role = 'manager' then
    v_my_dept := public.my_department(p_company_id);
    if v_my_dept is not null and v_my_dept = p_department_id then
      return true;
    end if;
  end if;

  -- Employees can't see other users' profiles (outside self) in MVP
  return false;
end;
$$;

-- ---------- RLS ----------
alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.departments enable row level security;
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.request_types enable row level security;
alter table public.department_request_type_settings enable row level security;
alter table public.requests enable row level security;
alter table public.request_steps enable row level security;
alter table public.request_comments enable row level security;
alter table public.request_attachments enable row level security;
alter table public.request_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.audit_log enable row level security;

-- Companies
drop policy if exists "companies_select" on public.companies;
create policy "companies_select"
on public.companies for select
using (public.is_company_member(id));

-- Branches
drop policy if exists "branches_select" on public.branches;
create policy "branches_select"
on public.branches for select
using (public.is_company_member(company_id));

-- Departments
drop policy if exists "departments_select" on public.departments;
create policy "departments_select"
on public.departments for select
using (public.is_company_member(company_id));

-- App settings: admin only
drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select"
on public.app_settings for select
using (false); -- not exposed to client

-- Profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles for select
using (public.can_select_profile(company_id, department_id, user_id));

-- Memberships
drop policy if exists "memberships_select" on public.memberships;
create policy "memberships_select"
on public.memberships for select
using (
  auth.uid() = user_id
  or public.is_admin_or_ceo(company_id)
  or (public.my_role(company_id) = 'manager' and public.my_department(company_id) = department_id)
);

-- Request types
drop policy if exists "request_types_select" on public.request_types;
create policy "request_types_select"
on public.request_types for select
using (public.is_company_member(company_id));

-- Department request type settings
drop policy if exists "dept_rts_select" on public.department_request_type_settings;
create policy "dept_rts_select"
on public.department_request_type_settings for select
using (public.is_company_member(company_id));

-- Requests
drop policy if exists "requests_select" on public.requests;
create policy "requests_select"
on public.requests for select
using (public.can_select_request(id));

-- Steps
drop policy if exists "steps_select" on public.request_steps;
create policy "steps_select"
on public.request_steps for select
using (public.can_select_request(request_id));

-- Comments
drop policy if exists "comments_select" on public.request_comments;
create policy "comments_select"
on public.request_comments for select
using (public.can_select_request(request_id));

-- Attachments
drop policy if exists "attachments_select" on public.request_attachments;
create policy "attachments_select"
on public.request_attachments for select
using (public.can_select_request(request_id));

-- Events
drop policy if exists "events_select" on public.request_events;
create policy "events_select"
on public.request_events for select
using (public.can_select_request(request_id));

-- Outbox: not exposed to client
drop policy if exists "outbox_select" on public.notification_outbox;
create policy "outbox_select"
on public.notification_outbox for select
using (false);

-- Audit log: admin/ceo OR request-scoped access
drop policy if exists "audit_select" on public.audit_log;
create policy "audit_select"
on public.audit_log for select
using (
  public.is_admin_or_ceo(company_id)
  or (request_id is not null and public.can_select_request(request_id))
);

-- ---------- Views ----------
create or replace view public.v_my_context as
select
  p.user_id,
  p.company_id,
  p.full_name,
  p.email,
  p.branch_id,
  p.department_id,
  m.role
from public.profiles p
join public.memberships m on m.company_id = p.company_id and m.user_id = p.user_id
where p.user_id = auth.uid();

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
  s.created_at as current_step_created_at,
  s.started_at as current_step_started_at,
  s.completed_at as current_step_completed_at,
  round(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0, 2) as current_step_age_hours,
  round(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 86400.0, 2) as current_step_age_days,
  round(extract(epoch from (now() - r.created_at)) / 3600.0, 2) as request_age_hours,
  round(extract(epoch from (now() - r.created_at)) / 86400.0, 2) as request_age_days
from public.requests r
left join public.request_steps s on s.id = r.current_step_id
left join public.request_types rt on rt.id = r.request_type_id
left join public.departments od on od.id = r.origin_department_id
left join public.departments d on d.id = s.department_id
;

-- Manager department workload (employees + assigned open steps)
create or replace view public.v_department_employee_workload as
select
  p.company_id,
  p.department_id,
  d.name as department_name,
  p.user_id,
  p.full_name,
  p.email,
  p.job_title,
  count(*) filter (where s.status in ('queued','in_progress','done_pending_approval')) as open_steps,
  count(*) filter (where s.status = 'in_progress') as in_progress_steps,
  round(avg(extract(epoch from (now() - coalesce(s.started_at, s.created_at))) / 3600.0) filter (where s.status in ('queued','in_progress','done_pending_approval')), 2) as avg_step_age_hours
from public.profiles p
join public.departments d on d.id = p.department_id
left join public.request_steps s on s.assigned_to = p.user_id
  and s.company_id = p.company_id
  and s.status in ('queued','in_progress','done_pending_approval')
group by p.company_id, p.department_id, d.name, p.user_id, p.full_name, p.email, p.job_title;

-- ---------- Notification helpers ----------
create or replace function public.enqueue_email(
  p_company_id uuid,
  p_template text,
  p_to_user_id uuid,
  p_to_email text,
  p_subject text,
  p_body text,
  p_payload jsonb default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
  values (p_company_id, p_template, p_to_user_id, p_to_email, p_subject, p_body, p_payload)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.department_manager_emails(p_company_id uuid, p_department_id uuid)
returns table(user_id uuid, email text, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.email, p.full_name
  from public.memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.company_id = p_company_id
    and m.role = 'manager'
    and m.department_id = p_department_id
    and p.is_active = true;
$$;

-- ---------- Request reference generator ----------
create or replace function public.generate_request_reference()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'OPS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.request_ref_seq')::text, 6, '0');
$$;

-- ---------- RPCs (write operations) ----------
-- NOTE: All write operations happen via RPCs (SECURITY DEFINER) to keep client-side permissions simple and safe.

create or replace function public.rpc_create_request(
  p_request_type_id uuid,
  p_title text,
  p_description text,
  p_target_department_id uuid,
  p_target_assignee_id uuid default null,
  p_priority smallint default null,
  p_due_at timestamptz default null
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

  select p.department_id, p.branch_id, p.full_name into v_origin_dept, v_origin_branch, v_requester_name
  from public.profiles p
  where p.user_id = auth.uid();

  v_ref := public.generate_request_reference();
  v_priority := coalesce(p_priority, (select default_priority from public.request_types where id = p_request_type_id));

  insert into public.requests(company_id, reference_code, title, description, request_type_id, priority,
                              requester_user_id, requester_name, origin_department_id, origin_branch_id, due_at)
  values (v_company, v_ref, p_title, p_description, p_request_type_id, v_priority,
          auth.uid(), v_requester_name, v_origin_dept, v_origin_branch, p_due_at)
  returning id into v_request_id;

  if p_target_assignee_id is not null then
    select full_name, email into v_assignee_name, v_assignee_email
    from public.profiles where user_id = p_target_assignee_id;
  end if;

  insert into public.request_steps(request_id, company_id, step_no, from_department_id, department_id,
                                   assigned_to, assignee_name, status, created_by, due_at)
  values (v_request_id, v_company, 1, v_origin_dept, p_target_department_id,
          p_target_assignee_id, v_assignee_name, 'queued', auth.uid(), p_due_at)
  returning id into v_step_id;

  update public.requests set current_step_id = v_step_id where id = v_request_id;

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

  -- Notify managers of target department (for visibility/assignment)
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

-- Assign step (manager/admin/ceo)
create or replace function public.rpc_assign_step(
  p_step_id uuid,
  p_assignee_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_dept uuid;
  v_req uuid;
  v_ref text;
  v_title text;
  v_assignee_name text;
  v_assignee_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select s.company_id, s.department_id, s.request_id into v_company, v_dept, v_req
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;

  if not (public.is_admin_or_ceo(v_company) or public.is_manager_of_department(v_company, v_dept)) then
    raise exception 'Not allowed to assign step';
  end if;

  select full_name, email into v_assignee_name, v_assignee_email
  from public.profiles where user_id = p_assignee_id;

  update public.request_steps
  set assigned_to = p_assignee_id,
      assignee_name = v_assignee_name,
      status = case when status = 'queued' then 'queued' else status end
  where id = p_step_id;

  select r.reference_code, r.title into v_ref, v_title
  from public.requests r where r.id = v_req;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (
    v_req,
    p_step_id,
    v_company,
    'assigned',
    'Step assigned to ' || coalesce(v_assignee_name,'user'),
    auth.uid(),
    jsonb_build_object('assignee_id', p_assignee_id, 'assignee_name', v_assignee_name)
  );

  if v_assignee_email is not null then
    perform public.enqueue_email(
      v_company,
      'step_assigned',
      p_assignee_id,
      v_assignee_email,
      'Task assigned: ' || v_ref,
      'You have been assigned task (' || v_ref || '): ' || v_title,
      jsonb_build_object('request_id', v_req, 'step_id', p_step_id)
    );
  end if;
end;
$$;

-- Start step (assignee)
create or replace function public.rpc_start_step(p_step_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_req uuid;
  v_assignee uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select company_id, request_id, assigned_to into v_company, v_req, v_assignee
  from public.request_steps where id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;
  if not (auth.uid() = v_assignee or public.is_admin_or_ceo(v_company)) then
    raise exception 'Not allowed to start step';
  end if;

  update public.request_steps
  set status = 'in_progress',
      started_at = coalesce(started_at, now())
  where id = p_step_id
    and status in ('queued','in_progress');

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by)
  values (v_req, p_step_id, v_company, 'started', 'Work started', auth.uid());
end;
$$;

-- Complete step (assignee) -> done_pending_approval, then auto-approve if configured
create or replace function public.rpc_complete_step(
  p_step_id uuid,
  p_completion_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_req uuid;
  v_assignee uuid;
  v_dept uuid;
  v_request_type uuid;
  v_ref text;
  v_title text;
  v_mode public.approval_mode;
  v_auto_close boolean;
  v_default_next_dept uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select s.company_id, s.request_id, s.assigned_to, s.department_id into v_company, v_req, v_assignee, v_dept
  from public.request_steps s where s.id = p_step_id;

  if v_company is null then raise exception 'Step not found'; end if;
  if not (auth.uid() = v_assignee or public.is_admin_or_ceo(v_company)) then
    raise exception 'Not allowed to complete step';
  end if;

  select r.request_type_id, r.reference_code, r.title into v_request_type, v_ref, v_title
  from public.requests r where r.id = v_req;

  update public.request_steps
  set status = 'done_pending_approval',
      completed_at = now(),
      completion_notes = p_completion_notes
  where id = p_step_id
    and status in ('queued','in_progress');

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by)
  values (v_req, p_step_id, v_company, 'completed', 'Work completed (pending approval)', auth.uid());

  -- Determine approval policy (department override -> default manual)
  select s.approval_mode, s.auto_close, s.default_next_department_id
  into v_mode, v_auto_close, v_default_next_dept
  from public.department_request_type_settings s
  where s.company_id = v_company and s.department_id = v_dept and s.request_type_id = v_request_type;

  if v_mode is null then
    v_mode := 'manual';
    v_auto_close := true;
    v_default_next_dept := null;
  end if;

  if v_mode = 'auto' then
    -- Auto-approve path: approve as system (auto_approved = true) then forward/close by policy.
    perform public.rpc_approve_step(p_step_id, v_default_next_dept, null, '[AUTO] Approved by policy');
    -- If auto_close is false and no default_next_dept, leave request open (manager can route later)
    if v_default_next_dept is null and v_auto_close = false then
      -- revert request closed logic inside approve_step is not triggered because next_dept is null,
      -- so we need a special-case: keep open and mark step approved but do not close request.
      update public.requests set status = 'open', closed_at = null where id = v_req;
    end if;
  else
    -- Notify managers for approval
    insert into public.notification_outbox(company_id, template, to_user_id, to_email, subject, body, payload)
    select
      v_company,
      'step_needs_approval',
      dm.user_id,
      dm.email,
      'Approval required: ' || v_ref,
      'A task step for (' || v_ref || ') is waiting for your approval.',
      jsonb_build_object('request_id', v_req, 'step_id', p_step_id)
    from public.department_manager_emails(v_company, v_dept) dm;
  end if;
end;
$$;

-- Approve step (manager/admin/ceo) and optionally forward to another department (creates next step)
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
  v_from_dept uuid;
  v_step_no integer;
  v_req_status public.request_status;
  v_next_step_no integer;
  v_next_step_id uuid;
  v_ref text;
  v_title text;
  v_next_assignee_name text;
  v_next_assignee_email text;
  v_role public.role_type;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select s.company_id, s.department_id, s.from_department_id, s.request_id, s.step_no
    into v_company, v_dept, v_from_dept, v_req, v_step_no
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
    and status in ('done_pending_approval','approved'); -- idempotent-ish

  select reference_code, title, status into v_ref, v_title, v_req_status
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

    insert into public.request_steps(request_id, company_id, step_no, from_department_id, department_id,
                                     assigned_to, assignee_name, status, created_by, due_at, related_step_id)
    values (v_req, v_company, v_next_step_no, v_dept, p_next_department_id,
            p_next_assignee_id, v_next_assignee_name, 'queued', auth.uid(), null, p_step_id)
    returning id into v_next_step_id;

    update public.requests
    set current_step_id = v_next_step_id,
        status = 'open',
        closed_at = null
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
    -- Close request by default
    update public.requests
    set status = 'closed',
        closed_at = now()
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

-- Return step back to previous department (manager/admin/ceo) - requires reason
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

  select coalesce(max(step_no),0) + 1 into v_next_step_no
  from public.request_steps where request_id = v_req;

  insert into public.request_steps(request_id, company_id, step_no, from_department_id, department_id,
                                   assigned_to, assignee_name, status, created_by, related_step_id)
  values (v_req, v_company, v_next_step_no, v_dept, v_return_dept,
          p_return_to_assignee_id, v_return_assignee_name, 'queued', auth.uid(), p_step_id)
  returning id into v_new_step_id;

  update public.requests
  set current_step_id = v_new_step_id,
      status = 'open',
      closed_at = null
  where id = v_req;

  select reference_code, title into v_ref, v_title
  from public.requests where id = v_req;

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

-- Add comment
create or replace function public.rpc_add_comment(
  p_request_id uuid,
  p_step_id uuid,
  p_body text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_comment_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_body is null or length(trim(p_body)) < 1 then raise exception 'Comment body is required'; end if;

  select company_id into v_company from public.requests where id = p_request_id;
  if v_company is null then raise exception 'Request not found'; end if;

  if not public.can_select_request(p_request_id) then
    raise exception 'Not allowed';
  end if;

  insert into public.request_comments(request_id, step_id, company_id, user_id, body)
  values (p_request_id, p_step_id, v_company, auth.uid(), p_body)
  returning id into v_comment_id;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by)
  values (p_request_id, p_step_id, v_company, 'commented', 'Comment added', auth.uid());

  return v_comment_id;
end;
$$;


-- Add attachment metadata (after successful Storage upload from client)
create or replace function public.rpc_add_attachment(
  p_request_id uuid,
  p_step_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_byte_size bigint default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_attachment_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_storage_path is null or length(trim(p_storage_path)) = 0 then raise exception 'storage_path required'; end if;
  if p_file_name is null or length(trim(p_file_name)) = 0 then raise exception 'file_name required'; end if;

  select company_id into v_company from public.requests where id = p_request_id;
  if v_company is null then raise exception 'Request not found'; end if;

  if not public.can_select_request(p_request_id) then
    raise exception 'Not allowed';
  end if;

  insert into public.request_attachments(request_id, step_id, company_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values (p_request_id, p_step_id, v_company, auth.uid(), p_storage_path, p_file_name, p_mime_type, p_byte_size)
  returning id into v_attachment_id;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (p_request_id, p_step_id, v_company, 'attachment_added', 'Attachment added', auth.uid(),
          jsonb_build_object('attachment_id', v_attachment_id, 'file_name', p_file_name));

  return v_attachment_id;
end;
$$;

-- Admin: create/update a request type
create or replace function public.rpc_admin_upsert_request_type(
  p_company_id uuid,
  p_name text,
  p_request_type_id uuid default null,
  p_description text default null,
  p_default_priority smallint default 3,
  p_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_admin(p_company_id) then raise exception 'Admin only'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'Name too short'; end if;

  v_id := coalesce(p_request_type_id, gen_random_uuid());

  insert into public.request_types(id, company_id, name, description, default_priority, active, created_by)
  values (v_id, p_company_id, p_name, p_description, p_default_priority, p_active, auth.uid())
  on conflict (id)
  do update set
    name = excluded.name,
    description = excluded.description,
    default_priority = excluded.default_priority,
    active = excluded.active;

  return v_id;
end;
$$;

-- Department manager can configure approval policy for a request type (manual/auto)
create or replace function public.rpc_set_department_request_type_setting(
  p_company_id uuid,
  p_department_id uuid,
  p_request_type_id uuid,
  p_approval_mode public.approval_mode,
  p_default_next_department_id uuid default null,
  p_auto_close boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if not (public.is_admin_or_ceo(p_company_id) or public.is_manager_of_department(p_company_id, p_department_id)) then
    raise exception 'Not allowed';
  end if;

  insert into public.department_request_type_settings(company_id, department_id, request_type_id, approval_mode, default_next_department_id, auto_close)
  values (p_company_id, p_department_id, p_request_type_id, p_approval_mode, p_default_next_department_id, p_auto_close)
  on conflict (company_id, department_id, request_type_id)
  do update set approval_mode = excluded.approval_mode,
                default_next_department_id = excluded.default_next_department_id,
                auto_close = excluded.auto_close,
                updated_at = now();
end;
$$;

-- Admin: set user role (promote/demote) and optionally department
create or replace function public.rpc_admin_set_user_role(
  p_company_id uuid,
  p_user_id uuid,
  p_role public.role_type,
  p_department_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_admin(p_company_id) then
    raise exception 'Admin only';
  end if;

  if p_role in ('employee','manager') and p_department_id is null then
    raise exception 'Department required for employee/manager';
  end if;

  update public.memberships
  set role = p_role,
      department_id = case when p_role in ('employee','manager') then p_department_id else null end,
      updated_at = now()
  where company_id = p_company_id and user_id = p_user_id;

  -- keep profile department in sync for employee/manager
  update public.profiles
  set department_id = case when p_role in ('employee','manager') then p_department_id else department_id end,
      updated_at = now()
  where user_id = p_user_id and company_id = p_company_id;
end;
$$;

-- Admin: rollback an UPDATE audit entry for requests/request_steps (best-effort)
create or replace function public.rpc_admin_rollback_audit(p_audit_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.audit_log%rowtype;
  v_table text;
  v_pk uuid;
begin
  select * into v_row from public.audit_log where id = p_audit_id;

  if v_row.id is null then
    raise exception 'Audit entry not found';
  end if;

  if not public.is_admin(v_row.company_id) then
    raise exception 'Admin only';
  end if;

  if v_row.action <> 'UPDATE' then
    raise exception 'Only UPDATE rollback supported in MVP';
  end if;

  v_table := v_row.table_name;

  if v_table = 'requests' then
    v_pk := (v_row.new_data->>'id')::uuid;
    update public.requests
    set title = coalesce(v_row.old_data->>'title', title),
        description = coalesce(v_row.old_data->>'description', description),
        priority = coalesce((v_row.old_data->>'priority')::smallint, priority),
        status = coalesce((v_row.old_data->>'status')::public.request_status, status),
        current_step_id = coalesce((v_row.old_data->>'current_step_id')::uuid, current_step_id),
        due_at = coalesce((v_row.old_data->>'due_at')::timestamptz, due_at),
        closed_at = (v_row.old_data->>'closed_at')::timestamptz
    where id = v_pk;

  elsif v_table = 'request_steps' then
    v_pk := (v_row.new_data->>'id')::uuid;
    update public.request_steps
    set assigned_to = (v_row.old_data->>'assigned_to')::uuid,
        assignee_name = (v_row.old_data->>'assignee_name'),
        status = coalesce((v_row.old_data->>'status')::public.step_status, status),
        started_at = (v_row.old_data->>'started_at')::timestamptz,
        completed_at = (v_row.old_data->>'completed_at')::timestamptz,
        completion_notes = (v_row.old_data->>'completion_notes'),
        approved_at = (v_row.old_data->>'approved_at')::timestamptz,
        approved_by = (v_row.old_data->>'approved_by')::uuid,
        auto_approved = coalesce((v_row.old_data->>'auto_approved')::boolean, auto_approved),
        approval_notes = (v_row.old_data->>'approval_notes'),
        returned_at = (v_row.old_data->>'returned_at')::timestamptz,
        return_reason = (v_row.old_data->>'return_reason')
    where id = v_pk;

  else
    raise exception 'Rollback not supported for table %', v_table;
  end if;

  insert into public.request_events(request_id, step_id, company_id, event_type, message, created_by, metadata)
  values (
    v_row.request_id,
    v_row.step_id,
    v_row.company_id,
    'rollback',
    'Admin rollback applied',
    auth.uid(),
    jsonb_build_object('audit_id', p_audit_id, 'table', v_table)
  );
end;
$$;

-- ---------- Auth trigger: create profile + membership on signup (local bootstrap) ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_company uuid;
  v_default_dept uuid;
  v_default_branch uuid;
  v_role public.role_type;
begin
  -- Default company/dept/branch used for local bootstrap
  select value::uuid into v_default_company from public.app_settings where key = 'default_company_id';
  select value::uuid into v_default_dept from public.app_settings where key = 'default_department_id';
  select value::uuid into v_default_branch from public.app_settings where key = 'default_branch_id';

  if v_default_company is null then
    -- If not bootstrapped yet, do nothing
    return new;
  end if;

  insert into public.profiles(user_id, company_id, full_name, email, branch_id, department_id)
  values (
    new.id,
    v_default_company,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    v_default_branch,
    v_default_dept
  )
  on conflict (user_id)
  do update set email = excluded.email,
                full_name = excluded.full_name,
                updated_at = now();

  if not exists (select 1 from public.memberships where company_id = v_default_company) then
    v_role := 'admin';
  else
    v_role := 'employee';
  end if;

  insert into public.memberships(company_id, user_id, role, branch_id, department_id, created_by)
  values (
    v_default_company,
    new.id,
    v_role,
    case when v_role in ('employee','manager') then v_default_branch else null end,
    case when v_role in ('employee','manager') then v_default_dept else null end,
    new.id
  )
  on conflict (company_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------- Grants ----------
-- Allow authenticated users to read via RLS policies
grant usage on schema public to anon, authenticated;

grant select on public.companies to authenticated;
grant select on public.branches to authenticated;
grant select on public.departments to authenticated;
grant select on public.profiles to authenticated;
grant select on public.memberships to authenticated;
grant select on public.request_types to authenticated;
grant select on public.department_request_type_settings to authenticated;
grant select on public.requests to authenticated;
grant select on public.request_steps to authenticated;
grant select on public.request_comments to authenticated;
grant select on public.request_attachments to authenticated;
grant select on public.request_events to authenticated;
grant select on public.audit_log to authenticated;

grant select on public.v_my_context to authenticated;
grant select on public.v_requests_current to authenticated;
grant select on public.v_department_employee_workload to authenticated;

-- Execute RPCs
grant execute on function public.rpc_create_request(uuid,text,text,uuid,uuid,smallint,timestamptz) to authenticated;
grant execute on function public.rpc_assign_step(uuid,uuid) to authenticated;
grant execute on function public.rpc_start_step(uuid) to authenticated;
grant execute on function public.rpc_complete_step(uuid,text) to authenticated;
grant execute on function public.rpc_approve_step(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.rpc_return_step(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.rpc_add_comment(uuid,uuid,text) to authenticated;

grant execute on function public.rpc_add_attachment(uuid,uuid,text,text,text,bigint) to authenticated;
grant execute on function public.rpc_admin_upsert_request_type(uuid,text,uuid,text,smallint,boolean) to authenticated;
grant execute on function public.rpc_set_department_request_type_setting(uuid,uuid,uuid,public.approval_mode,uuid,boolean) to authenticated;
grant execute on function public.rpc_admin_set_user_role(uuid,uuid,public.role_type,uuid) to authenticated;
grant execute on function public.rpc_admin_rollback_audit(bigint) to authenticated;

commit;
