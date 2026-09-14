-- Alter categories match_type constraint to allow OPEN match type

alter table public.categories drop constraint if exists categories_match_type_check;
alter table public.categories add constraint categories_match_type_check check (match_type in ('MENS', 'WOMENS', 'MIXED', 'OPEN'));
