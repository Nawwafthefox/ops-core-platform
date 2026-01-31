-- Force a single canonical rpc_admin_set_user_role in public schema:
-- 1) Drop ALL overloads regardless of signature
-- 2) Recreate ONE function with (uuid,uuid,text,uuid)

do $$
declare
  r record;
  args text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rpc_admin_set_user_role'
  loop
    args := pg_get_function_identity_arguments(r.oid);
    execute format('drop function if exists public.rpc_admin_set_user_role(%s);', args);
  end loop;
end $$;

-- Recreate canonical function expected by frontend
create function public.rpc_admin_set_user_role(
  p_company_id uuid,
  p_department_id uuid,
  p_role text,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
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

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id and company_id = p_company_id
  ) then
    raise exception 'User not found in company';
  end if;

  insert into public.memberships (company_id, user_id, department_id, role, created_at)
  values (p_company_id, p_user_id, p_department_id, v_role, now())
  on conflict (company_id, user_id)
  do update set
    department_id = excluded.department_id,
    role = excluded.role;
end;
$$;

grant execute on function public.rpc_admin_set_user_role(uuid,uuid,text,uuid) to authenticated;

-- Ask PostgREST to reload schema cache (best-effort)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
