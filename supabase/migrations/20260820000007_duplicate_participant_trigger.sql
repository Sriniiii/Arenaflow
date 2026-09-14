-- Enforce unique category registration per player

create or replace function public.check_duplicate_category_participant()
returns trigger as $$
begin
  if exists (
    select 1 from public.participant_members pm
    join public.participants p on pm.participant_id = p.id
    join public.participants p_new on p_new.id = new.participant_id
    where pm.player_id = new.player_id
    and p.category_id = p_new.category_id
  ) then
    raise exception 'Player is already registered in this category.' using errcode = '23505';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_check_duplicate_category_participant on public.participant_members;

create trigger tr_check_duplicate_category_participant
before insert on public.participant_members
for each row execute function public.check_duplicate_category_participant();
