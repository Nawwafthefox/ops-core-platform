-- Fix: Some schemas use profiles.user_id instead of profiles.id.
-- This RPC must not assume column names. It detects the correct columns and uses dynamic SQL.

drop function if exists public.rpc_admin_set_user_role(uuid,uuid,text,uuid);

create function public.rpc_admin_set_user_role(
  p_company_id uuid,
  p_department_id uuid,
  p_role text,
  p_target_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;

  v_profiles_user_col text;
  v_memberships_user_col text;

  v_exists int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin(p_company_id) then
    raise exception 'Admin only';
  end if;

  v_role := lower(trim(p_role));

  if v_role not in ('admin','ceo','manager','employee') then
    raise exception 'Invalid role';
  end if;

  -- Detect user identifier column in profiles: prefer "id" else "user_id"
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='id'
  ) then
    v_profiles_user_col := 'id';
  else
    v_profiles_user_col := 'user_id';
  end if;

  -- Detect user identifier column in memberships: prefer "user_id" else "profile_id" else "id"
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='memberships' and column_name='user_id'
  ) then
    v_memberships_user_col := 'user_id';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='memberships' and column_name='profile_id'
  ) then
    v_memberships_user_col := 'profile_id';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='memberships' and column_name='id'
  ) then
    v_memberships_user_col := 'id';
  else
    -- last resort: assume user_id
    v_memberships_user_col := 'user_id';
  end if;

  -- Ensure target user exists in company (dynamic col)
  execute format(
    'select 1 from public.profiles where company_id = $1 and %I = $2 limit 1',
    v_profiles_user_col
  )
  into v_exists
  using p_company_id, p_target_user_id;

  if v_exists is null then
    raise exception 'User not found in company';
  end if;

  -- Update membership first (no reliance on unique constraints)
  execute format(
    'update public.memberships
       set department_id = $1,
           role = $2
     where company_id = $3
       and %I = $4',
    v_memberships_user_col
  )
  using p_department_id, v_role, p_company_id, p_target_user_id;

  if found then
    return;
  end if;

  -- Insert if update did not find a row
  execute format(
    'insert into public.memberships (company_id, %I, department_id, role, created_at)
     values ($1, $2, $3, $4, now())',
    v_memberships_user_col
  )
  using p_company_id, p_target_user_id, p_department_id, v_role;

end;
$$;

grant execute on function public.rpc_admin_set_user_role(uuid,uuid,text,uuid) to authenticated;

-- Best-effort schema cache reload for PostgREST
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
