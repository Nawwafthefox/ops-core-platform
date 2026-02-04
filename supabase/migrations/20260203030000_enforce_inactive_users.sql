-- ============================================================
-- Enforce profile.is_active:
-- - inactive users cannot read tenant data (RLS helpers return false/null)
-- - inactive users cannot write anything (triggers block writes even via SECURITY DEFINER RPCs)
-- ============================================================

-- 1) helper: is_active_user()
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

-- 2) RLS helper hardening: inactive users are not members / have no role / no dept
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

-- (optional) keep is_admin_or_ceo consistent
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

grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.my_role(uuid) to authenticated;
grant execute on function public.my_department(uuid) to authenticated;
grant execute on function public.is_manager_of_department(uuid, uuid) to authenticated;
grant execute on function public.is_admin_or_ceo(uuid) to authenticated;

-- 3) Block writes by inactive users (covers SECURITY DEFINER RPCs too)
create or replace function public.block_inactive_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- allow service jobs / postgres actions (no JWT)
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_active_user() then
    raise exception 'Account disabled';
  end if;

  return new;
end;
$$;

-- Attach to tables that users mutate via UI/RPCs
drop trigger if exists trg_block_inactive_requests on public.requests;
create trigger trg_block_inactive_requests
before insert or update or delete on public.requests
for each row execute function public.block_inactive_writes();

drop trigger if exists trg_block_inactive_steps on public.request_steps;
create trigger trg_block_inactive_steps
before insert or update or delete on public.request_steps
for each row execute function public.block_inactive_writes();

drop trigger if exists trg_block_inactive_comments on public.request_comments;
create trigger trg_block_inactive_comments
before insert or update or delete on public.request_comments
for each row execute function public.block_inactive_writes();

drop trigger if exists trg_block_inactive_attachments on public.request_attachments;
create trigger trg_block_inactive_attachments
before insert or update or delete on public.request_attachments
for each row execute function public.block_inactive_writes();

drop trigger if exists trg_block_inactive_events on public.request_events;
create trigger trg_block_inactive_events
before insert or update or delete on public.request_events
for each row execute function public.block_inactive_writes();
