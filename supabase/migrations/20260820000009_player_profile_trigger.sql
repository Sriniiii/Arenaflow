-- Update handle_new_user trigger to also insert into public.players when role is PLAYER

create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_role text;
  v_full_name text;
  v_display_name text;
begin
  -- Get user-requested role from metadata, default to PLAYER
  default_role := coalesce(new.raw_user_meta_data->>'role', 'PLAYER');
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_display_name := coalesce(new.raw_user_meta_data->>'display_name', v_full_name, '');

  -- Security Check: Limit self-signup roles to PLAYER or ORGANIZER.
  if default_role not in ('PLAYER', 'ORGANIZER') then
    default_role := 'PLAYER';
  end if;

  -- 1. Insert into public.profiles
  insert into public.profiles (id, full_name, display_name, avatar_url, role)
  values (
    new.id,
    v_full_name,
    v_display_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    default_role
  );

  -- 2. If the role is PLAYER, automatically create public.players record
  if default_role = 'PLAYER' then
    insert into public.players (id, user_id, full_name, display_name)
    values (
      new.id,
      new.id,
      v_full_name,
      v_display_name
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$ language plpgsql security definer;
