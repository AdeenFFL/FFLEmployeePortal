-- Employee Portal — IT module: self-service offboarding (IT module revision, Phase 5). Lets any
-- employee file their own offboarding/resignation request, alongside (not replacing) the
-- existing HR-initiated path at /it/onboarding/new?kind=Offboarding.

begin;

-- Additive INSERT policy: Postgres ORs multiple policies for the same command, so this is kept
-- separate from "onboarding_offboarding insert by hr" rather than editing it, so each path's
-- intent stays legible on its own. No SELECT policy change needed — the existing
-- "requested_by = current_person_id()" clause already shows a self-filer their own record; the
-- deliberate "a leaver doesn't see an HR-initiated termination" gap stays intact because in that
-- case requested_by is HR, not the leaver. No change to it.lifecycle_before_insert() — it
-- already forces status='Open' and requested_by server-side regardless of which insert policy
-- let the row through.
create policy "onboarding_offboarding insert self offboarding" on it.onboarding_offboarding
  for insert to authenticated with check (
    kind = 'Offboarding' and person_id = current_person_id()
  );

commit;
