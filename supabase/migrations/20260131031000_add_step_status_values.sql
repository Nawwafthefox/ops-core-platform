-- Add additional step statuses required by the Policies & Procedures blueprint.
--
-- NOTE: Keep this in a standalone migration so other statements run after
-- a commit boundary (PostgreSQL enum safety: you generally should not use
-- newly-added enum values in the same transaction).

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'step_status'
  ) then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'step_status' and e.enumlabel = 'on_hold'
    ) then
      execute $q$alter type public.step_status add value 'on_hold'$q$;
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'step_status' and e.enumlabel = 'info_required'
    ) then
      execute $q$alter type public.step_status add value 'info_required'$q$;
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'step_status' and e.enumlabel = 'in_review'
    ) then
      execute $q$alter type public.step_status add value 'in_review'$q$;
    end if;
  end if;
end $$;
