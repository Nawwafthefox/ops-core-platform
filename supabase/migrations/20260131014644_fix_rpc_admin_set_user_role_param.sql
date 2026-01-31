-- Fix: frontend calls rpc_admin_set_user_role with p_target_user_id
-- but DB function uses p_user_id. PostgREST requires exact parameter names.

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
begin
  -- Call the existing implementation (the one that uses p_user_id)
  perform public.rpc_admin_set_user_role(
    p_company_id => p_company_id,
    p_department_id => p_department_id,
    p_role => p_role,
    p_user_id => p_target_user_id
  );
end;
$$;

-- Ensure authenticated can execute (same as your other RPCs)
grant execute on function public.rpc_admin_set_user_role(uuid,uuid,text,uuid) to authenticated;

-- Optional: ask PostgREST to reload schema cache (usually auto, but this forces it)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  -- ignore if notify channel not permitted
  null;
end $$;
