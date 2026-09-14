-- Create secure trigger to validate registration updates (cancellations) by players

create or replace function public.check_registration_update()
returns trigger as $$
declare
  v_tournament_id uuid;
begin
  -- Get tournament_id of the registration category
  select tournament_id into v_tournament_id
  from public.categories
  where id = new.category_id;

  -- If the user is organizer or platform admin, allow all modifications
  if public.is_tournament_organizer(v_tournament_id) or public.is_platform_admin() then
    return new;
  end if;

  -- Otherwise, it is a player attempting a cancellation
  -- 1. Ensure the player is actually part of this registration
  if not exists (
    select 1 from public.participant_members pm
    join public.players pl on pm.player_id = pl.id
    where pm.participant_id = new.participant_id
    and pl.user_id = auth.uid()
  ) then
    raise exception 'Unauthorized to update this registration.' using errcode = '42501';
  end if;

  -- 2. Only PENDING registrations can be cancelled
  if old.status != 'PENDING' then
    raise exception 'Only pending registrations can be cancelled.' using errcode = '42501';
  end if;

  -- 3. Players can only transition status to CANCELLED
  if new.status != 'CANCELLED' then
    raise exception 'Players can only cancel their registrations.' using errcode = '42501';
  end if;

  -- 4. Atomically mark corresponding participant as WITHDRAWN
  update public.participants
  set status = 'WITHDRAWN'
  where id = new.participant_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_check_registration_update on public.registrations;

create trigger tr_check_registration_update
before update on public.registrations
for each row execute function public.check_registration_update();
