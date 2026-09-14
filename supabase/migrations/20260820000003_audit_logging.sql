-- Secure system-only audit logging

-- Enable RLS on audit_logs
alter table public.audit_logs enable row level security;

-- 1. Read Policy: Only Platform Admin can read audit logs
create policy "Only Platform Admins can read audit logs" on public.audit_logs
  for select using (public.is_platform_admin());

-- 2. Write Policy: Deny all direct client-side inserts/updates/deletes
create policy "Deny direct client-side audit insertions" on public.audit_logs
  for insert with check (false);

create policy "Deny direct client-side audit updates" on public.audit_logs
  for update using (false);

create policy "Deny direct client-side audit deletes" on public.audit_logs
  for delete using (false);


-- 3. Secure security definer function to perform audit insertions
create or replace function public.log_action(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_old_data jsonb default null,
  p_new_data jsonb default null
)
returns uuid as $$
declare
  log_id uuid;
begin
  insert into public.audit_logs (actor_id, action, target_type, target_id, old_data, new_data)
  values (p_actor_id, p_action, p_target_type, p_target_id, p_old_data, p_new_data)
  returning id into log_id;
  
  return log_id;
end;
$$ language plpgsql security definer;


-- 4. Automatically audit matches status and score changes
create or replace function public.audit_match_changes()
returns trigger as $$
begin
  -- Audit match score update or status change
  if (old.status <> new.status) or (old.winner_id is distinct from new.winner_id) then
    perform public.log_action(
      auth.uid(),
      'MATCH_STATUS_CHANGE',
      'matches',
      new.id,
      jsonb_build_object('status', old.status, 'winner_id', old.winner_id),
      jsonb_build_object('status', new.status, 'winner_id', new.winner_id)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists audit_match_changes_trigger on public.matches;
create trigger audit_match_changes_trigger
  after update on public.matches
  for each row execute procedure public.audit_match_changes();


-- 5. Automatically audit profile role changes
create or replace function public.audit_profile_role_changes()
returns trigger as $$
begin
  if old.role <> new.role then
    perform public.log_action(
      auth.uid(),
      'ROLE_CHANGE',
      'profiles',
      new.id,
      jsonb_build_object('role', old.role),
      jsonb_build_object('role', new.role)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists audit_profile_role_changes_trigger on public.profiles;
create trigger audit_profile_role_changes_trigger
  after update on public.profiles
  for each row execute procedure public.audit_profile_role_changes();
