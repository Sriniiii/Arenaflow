-- Recreate check_duplicate_category_participant trigger function to check registrations table status correctly.

create or replace function public.check_duplicate_category_participant()
returns trigger as $$
begin
  if exists (
    select 1 from public.participant_members pm
    join public.participants p on pm.participant_id = p.id
    join public.participants p_new on p_new.id = new.participant_id
    left join public.registrations r on r.participant_id = p.id
    where pm.player_id = new.player_id
    and p.category_id = p_new.category_id
    and p.id != p_new.id
    and (r.id is null or r.status not in ('REJECTED', 'CANCELLED'))
  ) then
    raise exception 'Player is already registered in this category.' using errcode = '23505';
  end if;
  return new;
end;
$$ language plpgsql;
