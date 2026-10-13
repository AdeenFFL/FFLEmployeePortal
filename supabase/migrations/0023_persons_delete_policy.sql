-- Employee Portal — persons never had a DELETE RLS policy (only insert/select/update), so
-- app/(protected)/admin/users/actions.ts's hardDeleteUser() would have silently deleted zero
-- rows under RLS (Supabase returns success with no error when a DELETE matches no visible rows)
-- while still deleting the Auth identity and logging a false "success" audit entry. Same gate as
-- the existing insert/update policies.

create policy "persons delete by admin" on persons
  for delete to authenticated using (is_admin(auth.uid()));
