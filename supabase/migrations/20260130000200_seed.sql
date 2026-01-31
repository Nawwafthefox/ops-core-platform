
-- Seed / bootstrap data for local development
begin;

-- Storage bucket for attachments
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

-- Storage policies: path convention is "requests/<request_id>/<filename>"
-- Example path: requests/0f2b6b1a-.../1700000000_invoice.pdf
-- NOTE: These policies use public.can_select_request(...) to enforce RBAC.
drop policy if exists "request_attachments_select" on storage.objects;
create policy "request_attachments_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'request-attachments'
  and split_part(name, '/', 1) = 'requests'
  and public.can_select_request( public.try_uuid(split_part(name,'/',2)) )
);

drop policy if exists "request_attachments_insert" on storage.objects;
create policy "request_attachments_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'request-attachments'
  and split_part(name, '/', 1) = 'requests'
  and owner = auth.uid()
  and public.can_select_request( public.try_uuid(split_part(name,'/',2)) )
);

drop policy if exists "request_attachments_delete" on storage.objects;
create policy "request_attachments_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'request-attachments'
  and split_part(name, '/', 1) = 'requests'
  and (
    owner = auth.uid()
    or public.is_admin_or_ceo(
      (select r.company_id from public.requests r where r.id = public.try_uuid(split_part(name,'/',2)))
    )
  )
);

-- Demo org + request types (for local MVP testing)
do $$
declare
  v_company uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();

  v_dept_ops uuid := gen_random_uuid();
  v_dept_hr uuid := gen_random_uuid();
  v_dept_fin uuid := gen_random_uuid();
  v_dept_it uuid := gen_random_uuid();

  v_type_general uuid := gen_random_uuid();
  v_type_routine uuid := gen_random_uuid();
begin
  insert into public.companies(id, name)
  values (v_company, 'Demo Company');

  insert into public.branches(id, company_id, name)
  values (v_branch, v_company, 'Head Office');

  insert into public.departments(id, company_id, branch_id, name, code)
  values
    (v_dept_ops, v_company, v_branch, 'Operations', 'OPS'),
    (v_dept_hr,  v_company, v_branch, 'HR',         'HR'),
    (v_dept_fin, v_company, v_branch, 'Finance',    'FIN'),
    (v_dept_it,  v_company, v_branch, 'IT Support', 'IT');

  insert into public.app_settings(key, value)
  values
    ('default_company_id', v_company::text),
    ('default_branch_id', v_branch::text),
    ('default_department_id', v_dept_ops::text)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  insert into public.request_types(id, company_id, name, description, default_priority)
  values
    (v_type_general, v_company, 'General Task', 'Cross-department task / ticket', 3),
    (v_type_routine, v_company, 'Routine', 'Routine internal work (can be auto-approved)', 2)
  on conflict (company_id, name) do nothing;

  -- Default policies: manual approvals for General Task; Routine is auto-approved in Operations
  insert into public.department_request_type_settings(company_id, department_id, request_type_id, approval_mode, auto_close)
  values
    (v_company, v_dept_ops, v_type_general, 'manual', true),
    (v_company, v_dept_hr,  v_type_general, 'manual', true),
    (v_company, v_dept_fin, v_type_general, 'manual', true),
    (v_company, v_dept_it,  v_type_general, 'manual', true),
    (v_company, v_dept_ops, v_type_routine, 'auto',   true)
  on conflict do nothing;
end $$;

commit;
