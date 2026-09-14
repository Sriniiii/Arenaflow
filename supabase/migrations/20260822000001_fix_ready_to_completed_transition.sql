-- Migration: 20260822000001_fix_ready_to_completed_transition.sql
-- Allow transitioning to COMPLETED directly from READY or SCHEDULED status values.

create or replace function public.validate_match_status_transition()
returns trigger as $$
declare
  v_tournament_id uuid;
  v_organizer_id uuid;
begin
  -- If status hasn't changed, do nothing
  if old.status = new.status then
    return new;
  end if;

  -- 1. Check if both participants are present before going to LIVE, READY or COMPLETED
  if new.status in ('READY', 'LIVE', 'COMPLETED') then
    if new.participant_a_id is null or new.participant_b_id is null then
      raise exception 'Cannot transition to % when participant is missing', new.status;
    end if;
  end if;

  -- 2. Validate transitions
  if old.status = 'SCHEDULED' and new.status not in ('READY', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
    raise exception 'Invalid status transition from SCHEDULED to %', new.status;
  elsif old.status = 'READY' and new.status not in ('LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
    raise exception 'Invalid status transition from READY to %', new.status;
  elsif old.status = 'LIVE' and new.status not in ('PAUSED', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
    raise exception 'Invalid status transition from LIVE to %', new.status;
  elsif old.status = 'PAUSED' and new.status not in ('LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
    raise exception 'Invalid status transition from PAUSED to %', new.status;
  elsif old.status = 'COMPLETED' and new.status not in ('FINAL', 'UNDER_REVIEW', 'CANCELLED', 'POSTPONED') then
    raise exception 'Invalid status transition from COMPLETED to %', new.status;
  elsif old.status = 'FINAL' and new.status <> 'UNDER_REVIEW' then
    raise exception 'Invalid status transition from FINAL to %', new.status;
  elsif old.status = 'UNDER_REVIEW' and new.status not in ('FINAL', 'COMPLETED', 'CANCELLED', 'POSTPONED') then
    raise exception 'Invalid status transition from UNDER_REVIEW to %', new.status;
  end if;

  -- 3. Verify permissions for FINAL -> UNDER_REVIEW transition
  if old.status = 'FINAL' and new.status = 'UNDER_REVIEW' then
    select t.id, t.organizer_id into v_tournament_id, v_organizer_id
    from public.categories c
    join public.tournaments t on c.tournament_id = t.id
    where c.id = new.category_id;

    if auth.uid() <> v_organizer_id and not public.is_tournament_admin(v_tournament_id) and not public.is_platform_admin() then
      raise exception 'Only the tournament organizer or admin can reopen a finalized match for correction';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;
