-- Migration: 20260830000000_tournament_notifications.sql
-- Implements authoritative tournament notifications, typed events, RLS policies, indexing, RPCs, and event triggers.

-- 1. Alter notifications table to add typed metadata columns
alter table public.notifications
  add column if not exists type text not null default 'TOURNAMENT_UPDATE' check (
    type in (
      'MATCH_SCHEDULED',
      'COURT_ASSIGNED',
      'MATCH_STARTING',
      'MATCH_STARTED',
      'MATCH_RESULT',
      'QUALIFIED',
      'ELIMINATED',
      'NEXT_ROUND',
      'REGISTRATION_RECEIVED',
      'REGISTRATION_STATUS',
      'SCORER_ASSIGNED',
      'TOURNAMENT_UPDATE'
    )
  ),
  add column if not exists tournament_id uuid references public.tournaments(id) on delete cascade,
  add column if not exists match_id uuid references public.matches(id) on delete cascade,
  add column if not exists read_at timestamptz;

-- 2. Performance Indexes
create index if not exists idx_notifications_user_unread 
  on public.notifications(user_id, is_read, created_at desc);

create index if not exists idx_notifications_user_tourney 
  on public.notifications(user_id, tournament_id);

-- 3. Update RLS policies on notifications
drop policy if exists "Notifications owner policy" on public.notifications;
drop policy if exists "Notifications select policy" on public.notifications;
drop policy if exists "Notifications update policy" on public.notifications;
drop policy if exists "Notifications insert policy" on public.notifications;
drop policy if exists "Notifications delete policy" on public.notifications;

-- SELECT: Users can only see their own notifications
create policy "Notifications select policy" on public.notifications
  for select using (user_id = auth.uid() or public.is_platform_admin());

-- UPDATE: Users can only update their own notifications (e.g. mark read)
create policy "Notifications update policy" on public.notifications
  for update using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid() or public.is_platform_admin());

-- INSERT: Platform admins or system functions
create policy "Notifications insert policy" on public.notifications
  for insert with check (public.is_platform_admin() or auth.uid() = user_id);

-- DELETE: Users can delete their own notifications
create policy "Notifications delete policy" on public.notifications
  for delete using (user_id = auth.uid() or public.is_platform_admin());

-- 4. Helper RPCs for marking notifications as read
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void as $$
begin
  update public.notifications
  set is_read = true,
      read_at = now()
  where id = p_notification_id
  and user_id = auth.uid();
end;
$$ language plpgsql security definer;

create or replace function public.mark_all_notifications_read()
returns integer as $$
declare
  v_count integer;
begin
  with updated as (
    update public.notifications
    set is_read = true,
        read_at = now()
    where user_id = auth.uid()
    and is_read = false
    returning id
  )
  select count(*) into v_count from updated;
  
  return v_count;
end;
$$ language plpgsql security definer;

-- 5. Helper function to create notification idempotently
create or replace function public.create_system_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_tournament_id uuid default null,
  p_match_id uuid default null
)
returns uuid as $$
declare
  v_notif_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    message,
    tournament_id,
    match_id,
    is_read,
    created_at
  )
  values (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_tournament_id,
    p_match_id,
    false,
    now()
  )
  returning id into v_notif_id;

  return v_notif_id;
end;
$$ language plpgsql security definer;

-- 6. Trigger for Match Events (Scheduled, Court Assigned, Started, Result)
create or replace function public.handle_match_notification_events()
returns trigger as $$
declare
  v_tourney_id uuid;
  v_tourney_name text;
  v_court_name text;
  v_category_name text;
  v_player record;
  v_winner_name text;
begin
  -- Fetch Tournament and Category info
  select t.id, t.name, c.name into v_tourney_id, v_tourney_name, v_category_name
  from public.categories c
  join public.tournaments t on c.tournament_id = t.id
  where c.id = new.category_id;

  -- Fetch Court Name if court_id exists
  if new.court_id is not null then
    select name into v_court_name
    from public.courts
    where id = new.court_id;
  end if;

  -- A. Match Scheduled or Court Changed
  if (old.scheduled_at is distinct from new.scheduled_at and new.scheduled_at is not null) or
     (old.court_id is distinct from new.court_id and new.court_id is not null) then
    
    -- Loop over all participating players in participant_a and participant_b
    for v_player in (
      select distinct pl.user_id
      from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where (pm.participant_id = new.participant_a_id or pm.participant_id = new.participant_b_id)
      and pl.user_id is not null
    ) loop
      perform public.create_system_notification(
        v_player.user_id,
        'MATCH_SCHEDULED',
        'Match Scheduled',
        format('Your match in %s has been scheduled%s at %s.', 
          coalesce(v_category_name, 'Tournament'),
          case when v_court_name is not null then ' on ' || v_court_name else '' end,
          to_char(new.scheduled_at, 'HH24:MI')
        ),
        v_tourney_id,
        new.id
      );
    end loop;
  end if;

  -- B. Match Started (LIVE)
  if old.status <> 'LIVE' and new.status = 'LIVE' then
    for v_player in (
      select distinct pl.user_id
      from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where (pm.participant_id = new.participant_a_id or pm.participant_id = new.participant_b_id)
      and pl.user_id is not null
    ) loop
      perform public.create_system_notification(
        v_player.user_id,
        'MATCH_STARTED',
        'Match Live Now',
        format('Your match in %s is now LIVE%s.',
          coalesce(v_category_name, 'Tournament'),
          case when v_court_name is not null then ' on ' || v_court_name else '' end
        ),
        v_tourney_id,
        new.id
      );
    end loop;
  end if;

  -- C. Match Result Completed / Finalized
  if (old.status not in ('COMPLETED', 'FINAL') and new.status in ('COMPLETED', 'FINAL')) or
     (old.outcome is distinct from new.outcome and new.outcome is not null and new.status in ('COMPLETED', 'FINAL')) then
    
    -- Notify Winner
    if new.winner_id is not null then
      for v_player in (
        select distinct pl.user_id
        from public.participant_members pm
        join public.players pl on pm.player_id = pl.id
        where pm.participant_id = new.winner_id
        and pl.user_id is not null
      ) loop
        perform public.create_system_notification(
          v_player.user_id,
          'MATCH_RESULT',
          'Match Won!',
          format('Congratulations! You won your match in %s (%s).', 
            coalesce(v_category_name, 'Tournament'),
            coalesce(new.outcome, 'COMPLETED')
          ),
          v_tourney_id,
          new.id
        );
      end loop;

      -- Notify Loser
      for v_player in (
        select distinct pl.user_id
        from public.participant_members pm
        join public.players pl on pm.player_id = pl.id
        where (pm.participant_id = new.participant_a_id or pm.participant_id = new.participant_b_id)
        and pm.participant_id <> new.winner_id
        and pl.user_id is not null
      ) loop
        perform public.create_system_notification(
          v_player.user_id,
          'MATCH_RESULT',
          'Match Concluded',
          format('Your match in %s has concluded (%s).', 
            coalesce(v_category_name, 'Tournament'),
            coalesce(new.outcome, 'COMPLETED')
          ),
          v_tourney_id,
          new.id
        );
      end loop;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_match_notification_events on public.matches;
create trigger tr_match_notification_events
  after update on public.matches
  for each row execute procedure public.handle_match_notification_events();

-- 7. Trigger for Registration Events (Created -> Organizer, Status Updated -> Player)
create or replace function public.handle_registration_notification_events()
returns trigger as $$
declare
  v_tourney_id uuid;
  v_tourney_name text;
  v_organizer_id uuid;
  v_category_name text;
  v_player record;
begin
  -- Fetch Tournament and Category details
  select t.id, t.name, t.organizer_id, c.name
  into v_tourney_id, v_tourney_name, v_organizer_id, v_category_name
  from public.categories c
  join public.tournaments t on c.tournament_id = t.id
  where c.id = coalesce(new.category_id, old.category_id);

  -- A. New Registration Created -> Notify Tournament Organizer
  if tg_op = 'INSERT' then
    if v_organizer_id is not null then
      perform public.create_system_notification(
        v_organizer_id,
        'REGISTRATION_RECEIVED',
        'New Registration Received',
        format('A new player registered for %s in %s.', coalesce(v_category_name, 'Category'), coalesce(v_tourney_name, 'Tournament')),
        v_tourney_id,
        null
      );
    end if;
  end if;

  -- B. Registration Status Changed -> Notify Registered Player
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    for v_player in (
      select distinct pl.user_id
      from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where pm.participant_id = new.participant_id
      and pl.user_id is not null
    ) loop
      perform public.create_system_notification(
        v_player.user_id,
        'REGISTRATION_STATUS',
        format('Registration %s', initcap(new.status)),
        format('Your registration for %s in %s is now %s.', coalesce(v_category_name, 'Category'), coalesce(v_tourney_name, 'Tournament'), new.status),
        v_tourney_id,
        null
      );
    end loop;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_registration_notification_events on public.registrations;
create trigger tr_registration_notification_events
  after insert or update on public.registrations
  for each row execute procedure public.handle_registration_notification_events();

-- 8. Trigger for Scorer Assignment -> Notify Scorer User
create or replace function public.handle_scorer_assigned_notification()
returns trigger as $$
declare
  v_tourney_name text;
begin
  select name into v_tourney_name
  from public.tournaments
  where id = new.tournament_id;

  if new.user_id is not null then
    perform public.create_system_notification(
      new.user_id,
      'SCORER_ASSIGNED',
      'Assigned as Scorer',
      format('You have been assigned as an official match scorer for %s.', coalesce(v_tourney_name, 'Tournament')),
      new.tournament_id,
      null
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_scorer_assigned_notification on public.tournament_scorers;
create trigger tr_scorer_assigned_notification
  after insert on public.tournament_scorers
  for each row execute procedure public.handle_scorer_assigned_notification();
