-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 8 — RLS hardening (09-it-procurement-plan.md §5 Phase 8)
-- Depends on:  javaria_it_0014_invoices.sql, javaria_it_0015_payments.sql
-- Applied to live DB: YES (confirmed live 2026-10-30 by read-only check)
--
-- Review findings fixed here
--   1. Money details were readable by anyone who can see the demand — including the plain
--      requester: invoices, payments (references, amounts) and invoice / payment-proof files.
--      Now: site / all-sites procurement staff, invoice managers, the department's invoice
--      approvers, and Finance. The requester still sees the demand, its status, deliveries and
--      timeline (which says "invoice logged / paid" without amounts beyond what's already there).
--   2. Finance needed it.demands.read_all just to open the demands behind the packages it
--      processes. Now Finance (it.payments.update) can read any demand that has an invoice sent
--      to Finance (via a security-definer helper, so the demands policy doesn't recurse into
--      invoices' policy).
--
-- Policies REPLACED: demands select, invoices select, payments select, documents select.

-- Staff-level view of a demand's money (no RLS recursion: reads the demand directly).
create function it.can_see_demand_finances(p_demand_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.demands d
    where d.id = p_demand_id
      and (
        it.can_see_site_demands(d.site_id)
        or it.can_manage_invoices(d.site_id)
        or it.is_invoice_approver(d.department_id)
        or it.is_finance()
      )
  );
$$;

-- Finance reaches the demands behind its packages.
create function it.finance_can_see_demand(p_demand_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select it.is_finance()
     and exists (
       select 1 from it.invoices i
       where i.demand_id = p_demand_id and i.deleted_at is null
         and i.status in ('Sent to Finance', 'Confirmed', 'Paid')
     );
$$;

revoke all on function it.can_see_demand_finances(uuid) from public;
revoke all on function it.finance_can_see_demand(uuid) from public;
grant execute on function it.can_see_demand_finances(uuid) to authenticated;
grant execute on function it.finance_can_see_demand(uuid) to authenticated;

-- 2. Demands: + Finance for its packages.
drop policy "demands select own, site staff or approver" on it.demands;
create policy "demands select own, site staff or approver" on it.demands
  for select to authenticated
  using (deleted_at is null
         and (requested_by_person_id = current_person_id()
              or it.can_see_site_demands(site_id)
              or (status not in ('Open', 'Categorized')
                  and (it.is_demand_approver(department_id) or it.is_invoice_approver(department_id)))
              or it.finance_can_see_demand(id)));

-- 1. Invoices / payments: staff, invoice approvers, Finance — not the plain requester.
drop policy "invoices readable with the demand" on it.invoices;
create policy "invoices readable by procurement, approvers and finance" on it.invoices
  for select to authenticated
  using (deleted_at is null and it.can_see_demand_finances(demand_id));

drop policy "payments readable with the demand" on it.payments;
create policy "payments readable by procurement, approvers and finance" on it.payments
  for select to authenticated
  using (deleted_at is null and it.can_see_demand_finances(demand_id));

-- Documents: demand / delivery files with the demand (quotation, challan, gate pass — the
-- requester may see their order arriving); invoice / payment files only with the finances.
drop policy "documents readable with the demand" on it.documents;
create policy "documents readable with the demand" on it.documents
  for select to authenticated
  using (
    demand_id is not null
    and exists (select 1 from it.demands d where d.id = demand_id)
    and (entity_type in ('demand', 'receiving') or it.can_see_demand_finances(demand_id))
  );
