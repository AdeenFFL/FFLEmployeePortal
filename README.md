# Employee Campsite

Fauji Food Vertical Employee Portal — Next.js (App Router) + Supabase. Base skeleton covers
identity/roles (Microsoft OAuth + password sign-in via Supabase Auth, no self-registration,
accounts provisioned by Admin), site/company configuration, and a permission-groups-based
access model (see `context.md` for the full architecture and decision record — this README
predates several since-superseded details below, kept for the local-setup mechanics only).

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in real values (see comments in that file).
3. Create a Supabase project, then run the migration in `supabase/migrations/0001_init_auth.sql`
   against it (paste into the Supabase SQL editor and run). This creates the `roles`,
   `permissions`, `role_permissions`, and `profiles` tables, enables RLS, and seeds the four
   baseline roles (Employee, HR, IT, Admin) with their default route permissions.
4. In the Supabase Dashboard → Authentication → URL Configuration, set the Site URL and add
   `{NEXT_PUBLIC_SITE_URL}/auth/callback` as an allowed redirect URL.
5. In the Supabase Dashboard → Authentication → Providers, enable **Azure** (Microsoft), filling
   in the client ID/secret/tenant from an Azure AD app registration (registered separately in
   Azure Portal). Point the app's own redirect URI at the callback URL Supabase shows you
   (typically `https://<project-ref>.supabase.co/auth/v1/callback`).
6. `npm run dev` and open [http://localhost:3000](http://localhost:3000).

### First-login flow

- A brand-new user who signs in gets a `profiles` row with `role_id = null` and lands on
  `/pending-setup`. An admin must assign a role (currently: update the row directly in the
  Supabase Table Editor — the admin UI for this is a future module) before the user can reach
  any role-specific screen.
- Setting a user's `status` to `Inactive` or `Suspended` in `profiles` blocks their next login
  (redirected to `/unauthorized?reason=inactive`) without deleting their record.
- Adding a 5th custom role is a data change (insert into `roles` / `role_permissions`), not a
  code change — see `lib/auth/route-permissions.ts` for how routes map to permission keys.

## Learn more

This project uses Next.js 16, which renamed `middleware.ts` to `proxy.ts` (see `proxy.ts` at the
repo root) — see [the Proxy docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
if extending route-guard logic.
