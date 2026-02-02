-- Tighten request visibility:
-- Employee: only current assignee
-- Manager: initiator OR currently in manager's department
-- Admin/CEO: company-wide
-- System admin: all

create or replace function public.can_select_request(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_requester_user_id uuid;
  v_current_step_id uuid;

  v_role public.role_type;
  v_my_dept uuid;

  v_step_dept uuid;
  v_step_assignee uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Fetch request core fields
  select r.company_id, r.requester_user_id, r.current_step_id
    into v_company_id, v_requester_user_id, v_current_step_id
  from public.requests r
  where r.id = p_request_id;

  if v_company_id is null then
    return false;
  end if;

  -- System admin sees all
  if public.is_system_admin() then
    return true;
  end if;

  -- Determine role in this company
  v_role := public.my_role(v_company_id);

  -- Non-members see nothing
  if v_role is null then
    return false;
  end if;

  -- Company-wide roles
  if v_role in ('admin'::public.role_type, 'ceo'::public.role_type) then
    return true;
  end if;

  -- If we have a current step, fetch its dept and assignee
  if v_current_step_id is not null then
    select s.department_id, s.assigned_to
      into v_step_dept, v_step_assignee
    from public.request_steps s
    where s.id = v_current_step_id;
  else
    v_step_dept := null;
    v_step_assignee := null;
  end if;

  -- Manager rules:
  -- 1) can always see what they initiated
  -- 2) can see any request currently in their department
  if v_role = 'manager'::public.role_type then
    v_my_dept := public.my_department(v_company_id);

    if v_requester_user_id = auth.uid() then
      return true;
    end if;

    if v_my_dept is not null and v_step_dept = v_my_dept then
      return true;
    end if;

    return false;
  end if;

  -- Employee rules: only current assignee
  if v_role = 'employee'::public.role_type then
    return v_step_assignee = auth.uid();
  end if;

  -- Default deny
  return false;
end;
$$;

-- Make sure authenticated can execute it (RLS evaluation needs it)
grant execute on function public.can_select_request(uuid) to authenticated;
