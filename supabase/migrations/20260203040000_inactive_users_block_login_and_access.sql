-- ============================================================
-- 1) Helper: is_active_user()
-- ============================================================
create or replace function public.is_active_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = coalesce(p_user_id, auth.uid())
      and coalesce(p.is_active, true) = true
  );
$$;

grant execute on function public.is_active_user(uuid) to authenticated;

-- ============================================================
-- 2) Harden membership helpers to deny inactive users everywhere
-- ============================================================
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user()
     and exists (
       select 1
       from public.memberships m
       where m.user_id = auth.uid()
         and m.company_id = p_company_id
     );
$$;

create or replace function public.my_role(p_company_id uuid)
returns public.role_type
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_active_user() then null
    else (
      select m.role
      from public.memberships m
      where m.user_id = auth.uid()
        and m.company_id = p_company_id
      limit 1
    )
  end;
$$;

create or replace function public.my_department(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_active_user() then null
    else (
      select m.department_id
      from public.memberships m
      where m.user_id = auth.uid()
        and m.company_id = p_company_id
      limit 1
    )
  end;
$$;

create or replace function public.is_admin_or_ceo(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user()
     and public.my_role(p_company_id) in ('admin'::public.role_type, 'ceo'::public.role_type);
$$;

create or replace function public.is_manager_of_department(p_company_id uuid, p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user()
     and public.my_role(p_company_id) = 'manager'::public.role_type
     and public.my_department(p_company_id) = p_department_id;
$$;

grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.my_role(uuid) to authenticated;
grant execute on function public.my_department(uuid) to authenticated;
grant execute on function public.is_admin_or_ceo(uuid) to authenticated;
grant execute on function public.is_manager_of_department(uuid, uuid) to authenticated;

-- ============================================================
-- 3) Tightened can_select_request: deny inactive users immediately
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

  -- Deny inactive users immediately
  if not public.is_active_user() then
    return false;
  end if;

  -- System admin (must still be active due to above)
  if public.is_system_admin() then
    return true;
  end if;

  -- User company
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

  -- Hard cross-company isolation
  if v_req_company <> v_my_company then
    return false;
  end if;

  v_role := public.my_role(v_req_company);
  if v_role is null then
    return false;
  end if;

  if v_role in ('admin'::public.role_type, 'ceo'::public.role_type) then
    return true;
  end if;

  if v_current_step is not null then
    select s.department_id, s.assigned_to
      into v_step_dept, v_step_assignee
    from public.request_steps s
    where s.id = v_current_step;
  end if;

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

  if v_role = 'employee'::public.role_type then
    return v_step_assignee = auth.uid();
  end if;

  return false;
end;
$$;

grant execute on function public.can_select_request(uuid) to authenticated;

-- ============================================================
-- 4) Update rpc_sys_set_profile_active to BAN/UNBAN Auth user
--    (blocks login) + revoke sessions/tokens (best-effort)
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rpc_sys_set_profile_active'
  loop
    execute format('drop function if exists %s;', r.sig);
  end loop;
end $$;

create function public.rpc_sys_set_profile_active(
  p_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_system_admin() then
    raise exception 'System admin only';
  end if;

  -- Update profile flag
  update public.profiles pr
  set is_active = p_is_active,
      updated_at = now()
  where pr.user_id = p_user_id;

  -- Ban/unban in Supabase Auth (blocks future login)
  if p_is_active then
    update auth.users u
    set banned_until = null
    where u.id = p_user_id;
  else
    update auth.users u
    set banned_until = now() + interval '100 years'
    where u.id = p_user_id;

    -- Best-effort: revoke existing sessions/tokens (table names vary by auth version)
    if to_regclass('auth.refresh_tokens') is not null then
      execute 'delete from auth.refresh_tokens where user_id = $1' using p_user_id;
    end if;

    if to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id = $1' using p_user_id;
    end if;
  end if;
end;
$$;

grant execute on function public.rpc_sys_set_profile_active(uuid, boolean) to authenticated;
