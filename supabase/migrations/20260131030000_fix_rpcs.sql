begin;

-- ---------------------------------------------------------------------
-- Fix 1: rpc_admin_upsert_request_type
-- ---------------------------------------------------------------------
-- The initial migration used a DEFAULT on p_request_type_id before a
-- non-default parameter (p_name), which PostgreSQL rejects.
-- We keep the frontend parameter names exactly as-is.

drop function if exists public.rpc_admin_upsert_request_type(
  uuid,
  uuid,
  text,
  text,
  smallint,
  boolean
);

create or replace function public.rpc_admin_upsert_request_type(
  p_company_id uuid,
  p_request_type_id uuid,
  p_name text,
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

grant execute on function public.rpc_admin_upsert_request_type(uuid,text,uuid,text,smallint,boolean) to authenticated;


-- ---------------------------------------------------------------------
-- Fix 2: rpc_admin_set_user_role
-- ---------------------------------------------------------------------
-- Frontend calls:
--   rpc_admin_set_user_role({
--     p_company_id,
--     p_department_id,
--     p_role,          -- may come as "CEO" (uppercase)
--     p_target_user_id
--   })
--
-- We provide a canonical function that:
--  - accepts p_role as TEXT (case-insensitive)
--  - casts into role_type safely
--  - upserts the membership row (no more duplicate-key errors)
--  - updates the profile's department for employee/manager
--
-- Note: We drop the original function that used role_type + p_user_id.

drop function if exists public.rpc_admin_set_user_role(
  uuid,
  uuid,
  public.role_type,
  uuid
);

create or replace function public.rpc_admin_set_user_role(
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
  v_role public.role_type;
  v_role_text text;
  v_profile_company uuid;
  v_profile_dept uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin(p_company_id) then
    raise exception 'Admin only';
  end if;

  v_role_text := lower(trim(coalesce(p_role,'')));

  -- Validate and cast
  if v_role_text not in ('admin','ceo','manager','employee') then
    raise exception 'Invalid role';
  end if;

  v_role := v_role_text::public.role_type;

  -- Ensure the target user has a profile within the company
  select company_id, department_id into v_profile_company, v_profile_dept
  from public.profiles
  where user_id = p_target_user_id;

  if v_profile_company is null then
    raise exception 'Target user has no profile row';
  end if;

  if v_profile_company <> p_company_id then
    raise exception 'Target user is not in this company';
  end if;

  -- Enforce scope rules
  if v_role in ('employee','manager') and p_department_id is null then
    raise exception 'Department is required for employee/manager';
  end if;

  if v_role in ('admin','ceo') and p_department_id is not null then
    raise exception 'Department must be NULL for admin/ceo';
  end if;

  -- Upsert membership (avoid duplicate key)
  insert into public.memberships (company_id, user_id, role, department_id, created_by)
  values (p_company_id, p_target_user_id, v_role, p_department_id, auth.uid())
  on conflict (company_id, user_id)
  do update set
    role = excluded.role,
    department_id = excluded.department_id,
    updated_at = now();

  -- Keep profile.department_id in sync for employee/manager
  if v_role in ('employee','manager') then
    update public.profiles
    set department_id = p_department_id,
        updated_at = now()
    where user_id = p_target_user_id;
  end if;

end;
$$;

grant execute on function public.rpc_admin_set_user_role(uuid,uuid,text,uuid) to authenticated;

commit;
