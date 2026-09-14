-- Migration: 20260822000000_match_lifecycle_and_scheduling.sql
-- Enforce match lifecycle transitions, scheduling conflict prevention, and scoring locks at the database level.

-- A. Scheduling Conflict Prevention
create or replace function public.validate_match_schedule()
returns trigger as $$
declare
  v_conflict_court boolean;
  v_conflict_participant boolean;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_new_duration integer;
  v_new_buffer integer;
  v_tourney_id uuid;
begin
  -- Only validate scheduled active matches
  if new.scheduled_at is null or new.status = 'CANCELLED' then
    return new;
  end if;

  -- Get duration and buffer fallbacks if null
  select c.tournament_id, 
         coalesce(new.duration_minutes, c.match_duration, t.default_match_duration, 45), 
         coalesce(new.buffer_minutes, c.buffer_time, t.default_buffer_time, 10)
  into v_tourney_id, v_new_duration, v_new_buffer
  from public.categories c
  join public.tournaments t on c.tournament_id = t.id
  where c.id = new.category_id;

  v_new_start := new.scheduled_at;
  v_new_end := v_new_start + (v_new_duration + v_new_buffer) * interval '1 minute';

  -- 1. Court Conflict Check
  if new.court_id is not null then
    select exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where m.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and m.status <> 'CANCELLED'
      and m.court_id = new.court_id
      and t.id = v_tourney_id
      and m.scheduled_at is not null
      and v_new_start < m.scheduled_at + (coalesce(m.duration_minutes, c.match_duration, t.default_match_duration, 45) + coalesce(m.buffer_minutes, c.buffer_time, t.default_buffer_time, 10)) * interval '1 minute'
      and m.scheduled_at < v_new_end
    ) into v_conflict_court;

    if v_conflict_court then
      raise exception 'Conflict: Court is already booked during this time.';
    end if;
  end if;

  -- 2. Participant Double-Booking Check
  if new.participant_a_id is not null or new.participant_b_id is not null then
    select exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where m.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and m.status <> 'CANCELLED'
      and t.id = v_tourney_id
      and m.scheduled_at is not null
      and (
        (new.participant_a_id is not null and (m.participant_a_id = new.participant_a_id or m.participant_b_id = new.participant_a_id))
        or
        (new.participant_b_id is not null and (m.participant_a_id = new.participant_b_id or m.participant_b_id = new.participant_b_id))
      )
      and v_new_start < m.scheduled_at + (coalesce(m.duration_minutes, c.match_duration, t.default_match_duration, 45) + coalesce(m.buffer_minutes, c.buffer_time, t.default_buffer_time, 10)) * interval '1 minute'
      and m.scheduled_at < v_new_end
    ) into v_conflict_participant;

    if v_conflict_participant then
      raise exception 'Conflict: Player is already scheduled for another match during this time.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists validate_match_schedule_trigger on public.matches;
create trigger validate_match_schedule_trigger
  before insert or update on public.matches
  for each row execute procedure public.validate_match_schedule();


-- B. Match Lifecycle Validation
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

  -- 1. Check if both participants are present before going to LIVE or READY
  if new.status in ('READY', 'LIVE') then
    if new.participant_a_id is null or new.participant_b_id is null then
      raise exception 'Cannot transition to % when participant is missing', new.status;
    end if;
  end if;

  -- 2. Validate transitions
  if old.status = 'SCHEDULED' and new.status not in ('READY', 'LIVE', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
    raise exception 'Invalid status transition from SCHEDULED to %', new.status;
  elsif old.status = 'READY' and new.status not in ('LIVE', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') then
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

drop trigger if exists validate_match_status_transition_trigger on public.matches;
create trigger validate_match_status_transition_trigger
  before update on public.matches
  for each row execute procedure public.validate_match_status_transition();


-- C. Scoring Lock on matches
create or replace function public.validate_match_events_lock()
returns trigger as $$
declare
  v_match_status text;
begin
  select status into v_match_status
  from public.matches
  where id = new.match_id;

  if v_match_status not in ('LIVE', 'UNDER_REVIEW') then
    raise exception 'Scoring is only allowed when match is LIVE or UNDER_REVIEW. Current status: %', v_match_status;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists validate_match_events_lock_trigger on public.match_events;
create trigger validate_match_events_lock_trigger
  before insert or update on public.match_events
  for each row execute procedure public.validate_match_events_lock();


-- D. RPC Functions
create or replace function public.start_match(p_match_id uuid)
returns void as $$
begin
  if not public.can_score_match(p_match_id, auth.uid()) then
    raise exception 'Unauthorized to manage match lifecycle';
  end if;

  update public.matches
  set status = 'LIVE',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = p_match_id;
end;
$$ language plpgsql security definer;


create or replace function public.pause_match(p_match_id uuid)
returns void as $$
begin
  if not public.can_score_match(p_match_id, auth.uid()) then
    raise exception 'Unauthorized to manage match lifecycle';
  end if;

  update public.matches
  set status = 'PAUSED',
      updated_at = now()
  where id = p_match_id;
end;
$$ language plpgsql security definer;


create or replace function public.resume_match(p_match_id uuid)
returns void as $$
begin
  if not public.can_score_match(p_match_id, auth.uid()) then
    raise exception 'Unauthorized to manage match lifecycle';
  end if;

  update public.matches
  set status = 'LIVE',
      updated_at = now()
  where id = p_match_id;
end;
$$ language plpgsql security definer;


create or replace function public.finalize_match(p_match_id uuid)
returns void as $$
begin
  if not public.can_score_match(p_match_id, auth.uid()) then
    raise exception 'Unauthorized to manage match lifecycle';
  end if;

  update public.matches
  set status = 'FINAL',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where id = p_match_id;
end;
$$ language plpgsql security definer;


create or replace function public.reopen_match_for_correction(p_match_id uuid)
returns void as $$
begin
  -- Trigger validate_match_status_transition will check the organizer/admin permission
  update public.matches
  set status = 'UNDER_REVIEW',
      updated_at = now()
  where id = p_match_id;
end;
$$ language plpgsql security definer;
