create or replace function public.rpc_dashboard_kpis()
returns table (
  scope text,                           -- personal | department | company
  company_id uuid,
  department_id uuid,
  active_tasks int,
  overdue_tasks int,
  pending_approval int,
  unassigned_tasks int,
  on_hold int,
  info_required int,
  avg_open_age_hours numeric,
  avg_cycle_time_hours_30d numeric,
  completed_steps_week int,
  approved_steps_week int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_company uuid;
  v_dept uuid;
  v_role public.role_type;
  v_scope text;

  v_week_start timestamptz := date_trunc('week', now());        -- ISO week (Mon). Change if you want Sun.
  v_week_end   timestamptz := date_trunc('week', now()) + interval '7 days';
  v_30d_start  timestamptz := now() - interval '30 days';
begin
  if auth.uid() is null then
    return;
  end if;

  -- Use your context view (should be membership-based)
  select c.company_id, c.department_id, c.role
    into v_company, v_dept, v_role
  from public.v_my_context c
  limit 1;

  if v_company is null or v_role is null then
    return;
  end if;

  if v_role in ('admin'::public.role_type, 'ceo'::public.role_type) then
    v_scope := 'company';
  elsif v_role = 'manager'::public.role_type then
    v_scope := 'department';
  else
    v_scope := 'personal';
  end if;

  return query
  with current_open as (
    -- current step only (active work)
    select
      r.id as request_id,
      r.company_id,
      s.id as step_id,
      s.department_id,
      s.assigned_to,
      s.status,
      s.created_at,
      s.started_at,
      s.due_at
    from public.requests r
    join public.request_steps s on s.id = r.current_step_id
    where r.company_id = v_company
      and r.status = 'open'
      and (
        v_scope = 'company'
        or (v_scope = 'department' and v_dept is not null and s.department_id = v_dept)
        or (v_scope = 'personal' and s.assigned_to = auth.uid())
      )
  ),
  k as (
    select
      count(*)::int as active_tasks,
      count(*) filter (where due_at is not null and due_at < now())::int as overdue_tasks,
      count(*) filter (where status = 'done_pending_approval')::int as pending_approval,
      count(*) filter (where assigned_to is null)::int as unassigned_tasks,
      count(*) filter (where status = 'on_hold')::int as on_hold,
      count(*) filter (where status = 'info_required')::int as info_required,
      round(avg(extract(epoch from (now() - coalesce(started_at, created_at))) / 3600.0)::numeric, 2) as avg_open_age_hours
    from current_open
  ),
  cycle_30d as (
    -- cycle time based on completed steps (last 30 days) within scope
    select
      round(
        avg(extract(epoch from (s.completed_at - coalesce(s.started_at, s.created_at))) / 3600.0)::numeric,
        2
      ) as avg_cycle_time_hours_30d
    from public.request_steps s
    join public.requests r on r.id = s.request_id
    where r.company_id = v_company
      and s.completed_at >= v_30d_start
      and (
        v_scope = 'company'
        or (v_scope = 'department' and v_dept is not null and s.department_id = v_dept)
        or (v_scope = 'personal' and s.assigned_to = auth.uid())
      )
  ),
  week_counts as (
    select
      count(*) filter (where s.completed_at >= v_week_start and s.completed_at < v_week_end)::int as completed_steps_week,
      count(*) filter (where s.approved_at  >= v_week_start and s.approved_at  < v_week_end)::int as approved_steps_week
    from public.request_steps s
    join public.requests r on r.id = s.request_id
    where r.company_id = v_company
      and (
        v_scope = 'company'
        or (v_scope = 'department' and v_dept is not null and s.department_id = v_dept)
        or (v_scope = 'personal' and s.assigned_to = auth.uid())
      )
  )
  select
    v_scope,
    v_company,
    case when v_scope = 'department' then v_dept else null end,
    k.active_tasks,
    k.overdue_tasks,
    k.pending_approval,
    k.unassigned_tasks,
    k.on_hold,
    k.info_required,
    k.avg_open_age_hours,
    c.avg_cycle_time_hours_30d,
    w.completed_steps_week,
    w.approved_steps_week
  from k
  cross join cycle_30d c
  cross join week_counts w;
end;
$$;

grant execute on function public.rpc_dashboard_kpis() to authenticated;
