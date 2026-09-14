# Deployment

## Web
Deploy Next.js to Vercel or equivalent.
Configure:
- Supabase URL
- Supabase anon/public key
- server-only secrets where needed

## Backend
Use Supabase project with migrations and seed data.

## Mobile
Use Expo/EAS for development builds and production builds.
Configure Android/iOS app identifiers, notifications, environment variables, and store metadata.

## Production checklist
- production Supabase project
- migrations applied
- RLS enabled
- storage policies
- auth URLs
- realtime configuration
- error monitoring
- analytics/privacy review
- backups
- environment variables
- domain
- HTTPS
- app store configuration
- final E2E smoke test

Never put service-role keys in web/mobile client bundles.
