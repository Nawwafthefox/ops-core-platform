-- Default departments: HR, IT Support, Operations, Legal affairs, Finance
-- 1) Backfill existing companies (add missing departments only)
with dept(name) as (
  values
    ('HR'),
    ('IT Support'),
    ('Operations'),
    ('Legal affairs'),
    ('Finance')
)
insert into public.departments (company_id, name)
select c.id, dept.name
from public.companies c
cross join dept
where not exists (
  select 1
  from public.departments d
  where d.company_id = c.id
    and lower(d.name) = lower(dept.name)
);

-- 2) RPC: ensure defaults for a given company (system admin OR company admin/ceo)
drop function if exists public.rpc_sys_ensure_default_departments(uuid);

create function public.rpc_sys_ensure_default_departments(
  p_company_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not (public.is_system_admin() or public.is_admin_or_ceo(p_company_id)) then
    raise exception 'Not authorized';
  end if;

  with dept(name) as (
    values
      ('HR'),
      ('IT Support'),
      ('Operations'),
      ('Legal affairs'),
      ('Finance')
  ),
  ins as (
    insert into public.departments (company_id, name)
    select p_company_id, dept.name
    from dept
    where not exists (
      select 1
      from public.departments d
      where d.company_id = p_company_id
        and lower(d.name) = lower(dept.name)
    )
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;

grant execute on function public.rpc_sys_ensure_default_departments(uuid) to authenticated;

-- 3) Update rpc_sys_create_company to create default departments (and set default_department_id = Operations)
create or replace function public.rpc_sys_create_company(
  p_name text,
  p_make_me_admin boolean default true,
  p_create_default_department boolean default true,
  p_default_department_name text default 'General',
  p_switch_my_profile_company boolean default true
)
returns table (
  company_id uuid,
  company_name text,
  default_department_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_ops uuid;
begin
  if not public.is_system_admin() then
    raise exception 'System admin only';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Company name too short';
  end if;

  insert into public.companies (name)
  values (trim(p_name))
  returning id into v_company;

  if p_create_default_department then
    with dept(name) as (
      values
        ('HR'),
        ('IT Support'),
        ('Operations'),
        ('Legal affairs'),
        ('Finance')
    )
    insert into public.departments (company_id, name)
    select v_company, dept.name
    from dept
    where not exists (
      select 1
      from public.departments d
      where d.company_id = v_company
        and lower(d.name) = lower(dept.name)
    );

    select d.id into v_ops
    from public.departments d
    where d.company_id = v_company
      and lower(d.name) = lower('Operations')
    limit 1;
  else
    v_ops := null;
  end if;

  if p_switch_my_profile_company then
    update public.profiles
    set company_id = v_company,
        department_id = v_ops,
        updated_at = now()
    where user_id = auth.uid();
  end if;

  if p_make_me_admin then
    insert into public.memberships (company_id, user_id, department_id, role)
    values (v_company, auth.uid(), null, 'admin'::public.role_type)
    on conflict (company_id, user_id)
    do update set department_id = null, role = 'admin'::public.role_type;
  end if;

  return query
  select v_company, (select name from public.companies where id = v_company), v_ops;
end;
$$;

grant execute on function public.rpc_sys_create_company(text, boolean, boolean, text, boolean) to authenticated;
