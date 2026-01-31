-- Fix: avoid referencing profiles.id when it doesn't exist.
-- Use dynamic SQL to check target user in company.

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
  v_role_text text;
  v_role_enum public.role_type;

  v_profiles_key_col text;
  v_has_profile boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin(p_company_id) then
    raise exception 'Admin only';
  end if;

  v_role_text := lower(trim(p_role));

  -- Cast to enum (case-insensitive input)
  begin
    v_role_enum := v_role_text::public.role_type;
  exception when invalid_text_representation then
    raise exception 'Invalid role';
  end;

  -- Detect whether profiles uses "user_id" or "id" as the auth user key
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='user_id'
  ) then
    v_profiles_key_col := 'user_id';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='id'
  ) then
    v_profiles_key_col := 'id';
  else
    raise exception 'profiles table missing user key column';
  end if;

  -- Check user belongs to company (dynamic SQL prevents "column id does not exist")
  execute format(
    'select exists (select 1 from public.profiles where company_id = $1 and %I = $2)',
    v_profiles_key_col
  )
  into v_has_profile
  using p_company_id, p_target_user_id;

  if not v_has_profile then
    raise exception 'User not found in company';
  end if;

  -- UPSERT membership (unique key: company_id, user_id)
  insert into public.memberships (company_id, user_id, department_id, role, created_at)
  values (p_company_id, p_target_user_id, p_department_id, v_role_enum, now())
  on conflict (company_id, user_id)
  do update set
    department_id = excluded.department_id,
    role = excluded.role;

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
