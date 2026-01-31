-- Fix duplicate key on memberships(company_id, user_id)
-- Use proper UPSERT with ON CONFLICT.
-- Keep frontend param name p_target_user_id.
-- Cast p_role (text) -> role_type enum.

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
  v_has_profile boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin(p_company_id) then
    raise exception 'Admin only';
  end if;

  v_role_text := lower(trim(p_role));

  -- Cast to enum (fails if not valid)
  begin
    v_role_enum := v_role_text::public.role_type;
  exception when invalid_text_representation then
    raise exception 'Invalid role';
  end;

  -- Ensure target user exists in this company
  -- (your schema might use profiles.id or profiles.user_id; support both)
  select exists (
    select 1 from public.profiles
    where company_id = p_company_id
      and (
        (exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='id')
         and id = p_target_user_id)
        or
        (exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='user_id')
         and user_id = p_target_user_id)
      )
  ) into v_has_profile;

  if not v_has_profile then
    raise exception 'User not found in company';
  end if;

  -- Canonical memberships columns are company_id + user_id (unique)
  -- Upsert: update department + role if membership exists
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
