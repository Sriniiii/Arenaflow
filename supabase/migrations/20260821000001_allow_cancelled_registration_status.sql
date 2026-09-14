-- Alter registrations status constraint to support CANCELLED status

alter table public.registrations drop constraint if exists registrations_status_check;
alter table public.registrations add constraint registrations_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
