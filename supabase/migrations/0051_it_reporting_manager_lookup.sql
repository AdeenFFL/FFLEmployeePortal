-- Reporting manager becomes a real employee reference instead of free text, so the onboarding
-- form's lookup field stores an actual person, not arbitrary typed text. reporting_manager_name
-- stays as a denormalized display column (set server-side from the chosen person at creation
-- time, same as employee_name/employee_code already work for the request's own subject).

begin;

alter table it.onboarding_offboarding
  add column reporting_manager_id uuid references public.persons(id) on delete set null;

commit;
