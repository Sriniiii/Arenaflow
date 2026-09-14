-- Insert default active sports configuration
insert into public.sports (name, slug, is_active)
values ('Badminton', 'badminton', true)
on conflict (slug) do nothing;
