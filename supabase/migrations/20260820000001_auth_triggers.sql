-- Auth triggers and role protection

-- 1. Helper function to check if updater is Platform Admin
create or replace function public.is_platform_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'PLATFORM_ADMIN'
  );
end;
$$ language plpgsql security definer;

-- 2. Trigger function to automatically create profiles upon signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_role text;
begin
  -- Get user-requested role from metadata, default to PLAYER
  default_role := coalesce(new.raw_user_meta_data->>'role', 'PLAYER');

  -- Security Check: Limit self-signup roles to PLAYER or ORGANIZER.
  -- Platform Admins, Scorers, and Tournament Admins must be set via admin actions.
  if default_role not in ('PLAYER', 'ORGANIZER') then
    default_role := 'PLAYER';
  end if;

  insert into public.profiles (id, full_name, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    default_role
  );
  return new;
end;
$$ language plpgsql security definer;

-- Bind handle_new_user to auth.users created trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 3. Trigger function to protect role from self-update
create or replace function public.protect_profile_role()
returns trigger as $$
begin
  -- If role has changed, verify the actor is a Platform Admin
  if new.role <> old.role then
    if not public.is_platform_admin() then
      -- Revert role change
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Bind role protection trigger to public.profiles before update
drop trigger if exists protect_profile_role_trigger on public.profiles;
create trigger protect_profile_role_trigger
  before update on public.profiles
  for each row execute procedure public.protect_profile_role();
