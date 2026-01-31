set search_path = public;

create table if not exists public.system_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.system_admins enable row level security;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.system_admins sa
    where sa.user_id = auth.uid()
  );
$$;

grant execute on function public.is_system_admin() to authenticated;

drop policy if exists system_admins_select on public.system_admins;
create policy system_admins_select
on public.system_admins
for select
to public
using (public.is_system_admin());

drop policy if exists system_admins_modify on public.system_admins;
create policy system_admins_modify
on public.system_admins
for all
to public
using (public.is_system_admin())
with check (public.is_system_admin());

create or replace function public.rpc_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'is_system_admin', public.is_system_admin()
  );
$$;

grant execute on function public.rpc_whoami() to authenticated;

do $$
declare r record;
begin
  for r in
    select quote_ident(schemaname) as schem, quote_ident(viewname) as v
    from pg_views
    where schemaname = 'public'
  loop
    execute 'grant select on ' || r.schem || '.' || r.v || ' to authenticated';
  end loop;
end $$;

create or replace function public.rpc_sys_list_users(
  p_company_id uuid default null
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  is_active boolean,
  profile_company_id uuid,
  profile_company_name text,
  membership_role role_type,
  membership_department_id uuid,
  membership_department_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.email,
    p.full_name,
    p.is_active,
    p.company_id as profile_company_id,
    c.name as profile_company_name,
    m.role as membership_role,
    m.department_id as membership_department_id,
    d.name as membership_department_name,
    p.created_at
  from public.profiles p
  join public.companies c on c.id = p.company_id
  left join public.memberships m
    on m.user_id = p.user_id
   and m.company_id = p.company_id
  left join public.departments d on d.id = m.department_id
  where public.is_system_admin()
    and (p_company_id is null or p.company_id = p_company_id)
  order by c.name, p.full_name nulls last, p.email;
$$;

grant execute on function public.rpc_sys_list_users(uuid) to authenticated;

create or replace function public.rpc_sys_set_membership_role(
  p_company_id uuid,
  p_user_id uuid,
  p_role role_type,
  p_department_id uuid default null
)
returns table (
  company_id uuid,
  user_id uuid,
  role role_type,
  department_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_company uuid;
begin
  if not public.is_system_admin() then
    raise exception 'System admin only';
  end if;

  select company_id into v_profile_company
  from public.profiles
  where user_id = p_user_id;

  if v_profile_company is null then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  if v_profile_company <> p_company_id then
    raise exception 'User belongs to a different company (profile.company_id=%)', v_profile_company;
  end if;

  if p_role in ('admin'::role_type, 'ceo'::role_type) then
    if p_department_id is not null then
      raise exception 'Role % must not have a department_id', p_role;
    end if;
  else
    if p_department_id is null then
      raise exception 'Role % requires a department_id', p_role;
    end if;

    if not exists (
      select 1 from public.departments
      where id = p_department_id and company_id = p_company_id
    ) then
      raise exception 'Department % does not belong to company %', p_department_id, p_company_id;
    end if;
  end if;

  insert into public.memberships (company_id, user_id, department_id, role)
  values (p_company_id, p_user_id, p_department_id, p_role)
  on conflict (company_id, user_id)
  do update set department_id = excluded.department_id, role = excluded.role;

  return query
  select m.company_id, m.user_id, m.role, m.department_id
  from public.memberships m
  where m.company_id = p_company_id and m.user_id = p_user_id;
end;
$$;

grant execute on function public.rpc_sys_set_membership_role(uuid, uuid, role_type, uuid) to authenticated;

create or replace function public.rpc_sys_remove_membership(
  p_company_id uuid,
  p_user_id uuid
)
returns table (
  company_id uuid,
  user_id uuid,
  removed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_company uuid;
  v_count int;
begin
  if not public.is_system_admin() then
    raise exception 'System admin only';
  end if;

  select company_id into v_profile_company
  from public.profiles
  where user_id = p_user_id;

  if v_profile_company is null then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  if v_profile_company <> p_company_id then
    raise exception 'User belongs to a different company (profile.company_id=%)', v_profile_company;
  end if;

  delete from public.memberships
  where company_id = p_company_id and user_id = p_user_id;

  get diagnostics v_count = row_count;
  return query select p_company_id, p_user_id, (v_count > 0);
end;
$$;

grant execute on function public.rpc_sys_remove_membership(uuid, uuid) to authenticated;

create or replace function public.rpc_sys_set_profile_active(
  p_user_id uuid,
  p_is_active boolean
)
returns table (
  user_id uuid,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System admin only';
  end if;

  update public.profiles
  set is_active = p_is_active,
      updated_at = now()
  where user_id = p_user_id;

  if not found then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  return query
  select user_id, is_active
  from public.profiles
  where user_id = p_user_id;
end;
$$;

grant execute on function public.rpc_sys_set_profile_active(uuid, boolean) to authenticated;

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
  v_dept uuid;
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
    insert into public.departments (company_id, name)
    values (v_company, coalesce(nullif(trim(p_default_department_name),''), 'General'))
    returning id into v_dept;
  else
    v_dept := null;
  end if;

  if p_switch_my_profile_company then
    update public.profiles
    set company_id = v_company,
        updated_at = now()
    where user_id = auth.uid();
  end if;

  if p_make_me_admin then
    insert into public.memberships (company_id, user_id, department_id, role)
    values (v_company, auth.uid(), null, 'admin')
    on conflict (company_id, user_id)
    do update set department_id = null, role = 'admin';
  end if;

  return query
  select v_company, (select name from public.companies where id = v_company), v_dept;
end;
$$;

grant execute on function public.rpc_sys_create_company(text, boolean, boolean, text, boolean) to authenticated;
