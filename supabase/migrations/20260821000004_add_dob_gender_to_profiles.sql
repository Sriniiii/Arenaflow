-- Add date_of_birth and gender to profiles, and update new user trigger

alter table public.profiles
  add column if not exists gender text check (gender in ('MALE', 'FEMALE')),
  add column if not exists date_of_birth date;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_role text;
  v_full_name text;
  v_display_name text;
  v_gender text;
  v_dob date;
begin
  -- Get user-requested role from metadata, default to PLAYER
  default_role := coalesce(new.raw_user_meta_data->>'role', 'PLAYER');
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_display_name := coalesce(new.raw_user_meta_data->>'display_name', v_full_name, '');
  v_gender := new.raw_user_meta_data->>'gender';
  
  if new.raw_user_meta_data->>'date_of_birth' is not null then
    v_dob := (new.raw_user_meta_data->>'date_of_birth')::date;
  end if;

  -- Security Check: Limit self-signup roles to PLAYER or ORGANIZER.
  if default_role not in ('PLAYER', 'ORGANIZER') then
    default_role := 'PLAYER';
  end if;

  -- 1. Insert into public.profiles
  insert into public.profiles (id, full_name, display_name, avatar_url, role, gender, date_of_birth)
  values (
    new.id,
    v_full_name,
    v_display_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    default_role,
    v_gender,
    v_dob
  );

  -- 2. If the role is PLAYER, automatically create public.players record
  if default_role = 'PLAYER' then
    insert into public.players (id, user_id, full_name, display_name, gender, date_of_birth)
    values (
      new.id,
      new.id,
      v_full_name,
      v_display_name,
      v_gender,
      v_dob
    )
    on conflict (id) do update set
      gender = excluded.gender,
      date_of_birth = excluded.date_of_birth;
  end if;

  return new;
end;
$$ language plpgsql security definer;
