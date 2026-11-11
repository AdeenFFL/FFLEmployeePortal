-- Employee Portal — core: links public.invited_users back to the IT onboarding request that
-- staged it, so the Role Assignment onboarding task (and anything else) can reliably find "is
-- there a pending invite for this request" without fragile email-matching. Nullable — every
-- other invited_users row (the existing Admin → Users "Add New User" flow) keeps this null.

begin;

alter table invited_users
  add column onboarding_request_id uuid references it.onboarding_offboarding(id) on delete set null;

create index invited_users_onboarding_request_idx on invited_users (onboarding_request_id)
  where onboarding_request_id is not null;

commit;
