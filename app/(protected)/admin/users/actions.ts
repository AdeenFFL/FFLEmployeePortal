"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit/log";
import { sendInviteEmail } from "@/lib/email/invite";
import type { UserStatus, AuthMethod, EmploymentType } from "@/types/database";

const MIN_PASSWORD_LENGTH = 6; // Supabase's own GoTrue default minimum

// Known gap (flagged, not silently dropped): profiles.department/site were free text with no
// destination on `persons` — persons.company_id/site_id are proper FKs that this pass doesn't
// wire a picker for yet (see 0008_org_hierarchy_fix_and_identity_split.sql step B.4 comment, and
// 04-claude-code-refactor-instructions.md Section 6 — full FK-based org pickers are an explicit
// fast-follow once a module needs them, not required for this base-identity pass).
function readUserFormFields(formData: FormData) {
  return {
    full_name: String(formData.get("display_name") ?? "").trim() || null,
    role_id: String(formData.get("role_id") ?? ""),
    status: (String(formData.get("status") ?? "Active") as UserStatus) ?? "Active",
    notes: String(formData.get("notes") ?? "").trim() || null,
    employee_code: String(formData.get("employee_code") ?? "").trim() || null,
    designation: String(formData.get("designation") ?? "").trim() || null,
    date_of_joining: String(formData.get("date_of_joining") ?? "").trim() || null,
    employment_type:
      (String(formData.get("employment_type") ?? "").trim() || null) as EmploymentType | null,
  };
}

export async function inviteOrUpdateUser(formData: FormData) {
  const { supabase, personId: adminPersonId, actorLabel } = await requireAdmin();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fields = readUserFormFields(formData);

  if (!email || !fields.role_id) {
    throw new Error("Email and Role are required.");
  }

  // Re-derive new-vs-edit from a trusted server read, not a client-supplied flag. Login email
  // now lives on user_accounts, not persons.
  const { data: existingAccount } = await supabase
    .from("user_accounts")
    .select("person_id")
    .eq("email", email)
    .maybeSingle();

  if (existingAccount) {
    // Editing a real user — email itself stays tied to their identity, not editable here.
    // Sign-in method is fixed at creation — the submitted auth_method (if any) is deliberately
    // never read on this branch. persons.full_name is NOT NULL (unlike the old
    // profiles.display_name) — fall back to email if the admin clears the display name field.
    const { role_id, ...personFields } = fields;
    const { error } = await supabase
      .from("persons")
      .update({ ...personFields, full_name: personFields.full_name ?? email })
      .eq("id", existingAccount.person_id);
    if (error) throw new Error(error.message);

    // The UI still assigns exactly one role per person for now (schema supports multi-role;
    // see 04-claude-code-refactor-instructions.md Section 6) — delete-then-insert the one row.
    const { error: roleDeleteError } = await supabase
      .from("user_roles")
      .delete()
      .eq("person_id", existingAccount.person_id);
    if (roleDeleteError) throw new Error(roleDeleteError.message);

    const { error: roleInsertError } = await supabase.from("user_roles").insert({
      person_id: existingAccount.person_id,
      role_id,
      granted_by: adminPersonId,
    });
    if (roleInsertError) throw new Error(roleInsertError.message);

    await logAuditEvent({
      supabase,
      actorId: adminPersonId,
      actorLabel,
      module: "admin",
      action: "MODIFIED",
      details: `Updated profile for ${email}`,
    });

    revalidatePath("/admin/users");
    return;
  }

  const authMethod = String(formData.get("auth_method") ?? "microsoft") as AuthMethod;

  if (authMethod === "password") {
    const password = String(formData.get("password") ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const admin = createAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no email flow exists to confirm otherwise
    });

    if (createError) {
      if (
        createError.code === "email_exists" ||
        /already (been )?registered/i.test(createError.message)
      ) {
        throw new Error(`${email} is already registered.`);
      }
      throw new Error(createError.message);
    }

    const newUserId = created.user?.id;
    if (!newUserId) throw new Error("Account creation failed unexpectedly.");

    const { data: role } = await supabase
      .from("roles")
      .select("name")
      .eq("id", fields.role_id)
      .maybeSingle();

    // These three inserts go through the acting Admin's own RLS-respecting session (not the
    // service-role client) — the acting admin already satisfies the "insert by admin" RLS
    // policies on persons/user_accounts/user_roles, same justification as before the refactor.
    const { data: newPerson, error: personError } = await supabase
      .from("persons")
      .insert({
        full_name: fields.full_name ?? email,
        status: fields.status,
        notes: fields.notes,
        employee_code: fields.employee_code,
        designation: fields.designation,
        date_of_joining: fields.date_of_joining,
        employment_type: fields.employment_type,
      })
      .select("id")
      .single();

    if (personError || !newPerson) {
      // Roll back — otherwise this is a real, working login with no person record behind it.
      await admin.auth.admin.deleteUser(newUserId);
      throw new Error(personError?.message ?? "Failed to create person record.");
    }

    const { error: accountError } = await supabase.from("user_accounts").insert({
      person_id: newPerson.id,
      auth_user_id: newUserId,
      email,
      auth_method: "password",
    });

    if (accountError) {
      await supabase.from("persons").delete().eq("id", newPerson.id);
      await admin.auth.admin.deleteUser(newUserId);
      throw new Error(accountError.message);
    }

    const { error: roleError } = await supabase.from("user_roles").insert({
      person_id: newPerson.id,
      role_id: fields.role_id,
      granted_by: adminPersonId,
    });

    if (roleError) {
      await supabase.from("user_accounts").delete().eq("person_id", newPerson.id);
      await supabase.from("persons").delete().eq("id", newPerson.id);
      await admin.auth.admin.deleteUser(newUserId);
      throw new Error(roleError.message);
    }

    const emailResult = await sendInviteEmail({
      to: email,
      displayName: fields.full_name,
      authMethod: "password",
    });

    await logAuditEvent({
      supabase,
      actorId: adminPersonId,
      actorLabel,
      module: "admin",
      action: "CREATED",
      details: `Created password-based account for ${email} as ${role?.name ?? "Unknown role"}${
        emailResult.sent ? " (invite email sent)" : " (invite email FAILED to send)"
      }`,
    });

    revalidatePath("/admin/users");
    return;
  }

  // Microsoft path — new invite, or editing a still-pending one. Upsert on the email PK covers
  // both; check first so the audit log distinguishes a fresh invite from editing a pending one.
  const { data: existingInvite } = await supabase
    .from("invited_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  const { error } = await supabase.from("invited_users").upsert(
    {
      email,
      display_name: fields.full_name,
      role_id: fields.role_id,
      status: fields.status,
      notes: fields.notes,
      employee_code: fields.employee_code,
      designation: fields.designation,
      date_of_joining: fields.date_of_joining,
      // invited_users.invited_by has a stale DEFAULT auth.uid() left over from before the
      // persons/user_accounts split (its FK now points at persons(id), not auth.users(id) via
      // profiles) — must be passed explicitly or the insert violates the FK. See
      // 0011_fix_invited_by_default.sql.
      invited_by: adminPersonId,
    },
    { onConflict: "email" },
  );
  if (error) throw new Error(error.message);

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", fields.role_id)
    .maybeSingle();

  // Only on a genuinely fresh invite — editing a still-pending one's fields shouldn't re-email
  // them every time. Use the "Resend Invite" button for that.
  const emailResult = existingInvite
    ? null
    : await sendInviteEmail({ to: email, displayName: fields.full_name, authMethod: "microsoft" });

  await logAuditEvent({
    supabase,
    actorId: adminPersonId,
    actorLabel,
    module: "admin",
    action: existingInvite ? "MODIFIED" : "CREATED",
    details: existingInvite
      ? `Updated pending invitation for ${email}`
      : `Invited new user ${email} as ${role?.name ?? "Unknown role"}${
          emailResult?.sent ? " (invite email sent)" : " (invite email FAILED to send)"
        }`,
  });

  revalidatePath("/admin/users");
}

// Lets an admin re-send the invite notification for a pending Microsoft invitation without
// editing/resaving it — e.g. if the employee says they never got it, or it's been a while.
export async function resendInviteEmail(email: string) {
  const { supabase, personId: adminPersonId, actorLabel } = await requireAdmin();

  const normalizedEmail = email.trim().toLowerCase();
  const { data: invitation } = await supabase
    .from("invited_users")
    .select("display_name")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (!invitation) throw new Error("Invitation not found.");

  const emailResult = await sendInviteEmail({
    to: normalizedEmail,
    displayName: invitation.display_name,
    authMethod: "microsoft",
  });

  if (!emailResult.sent) {
    throw new Error(emailResult.error ?? "Failed to send invite email.");
  }

  await logAuditEvent({
    supabase,
    actorId: adminPersonId,
    actorLabel,
    module: "admin",
    action: "SYNCED",
    details: `Re-sent invite email to ${normalizedEmail}`,
  });

  revalidatePath("/admin/users");
}

// Decision: since "contact your administrator" is the only recovery path (no email flow), the
// Admin must be able to set a new password for an existing password-auth user.
export async function setUserPassword(personId: string, formData: FormData) {
  const { supabase, personId: adminPersonId, actorLabel } = await requireAdmin();

  const newPassword = String(formData.get("new_password") ?? "");
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("auth_user_id, email, auth_method")
    .eq("person_id", personId)
    .maybeSingle();
  if (!account) throw new Error("User not found.");
  if (account.auth_method !== "password") {
    throw new Error("This account signs in with Microsoft — there is no password to reset.");
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(account.auth_user_id, {
    password: newPassword,
  });
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminPersonId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Reset password for ${account.email}`, // never log the password itself
  });

  revalidatePath("/admin/users");
}

export async function setUserStatus(personId: string, status: UserStatus) {
  const { supabase, personId: adminPersonId, actorLabel } = await requireAdmin();

  if (personId === adminPersonId) {
    throw new Error("You cannot deactivate your own account.");
  }

  // Fetch the current values fresh (not passed from the caller/page) — a page-render-time
  // value could be stale by the time this actually submits. Status lives on `persons` (the
  // employment-level status; blocks login via both proxy.ts and the require*() helpers, which
  // also check it alongside user_accounts.status).
  const { data: before } = await supabase
    .from("persons")
    .select("status")
    .eq("id", personId)
    .maybeSingle();
  const { data: account } = await supabase
    .from("user_accounts")
    .select("email")
    .eq("person_id", personId)
    .maybeSingle();

  const { error } = await supabase.from("persons").update({ status }).eq("id", personId);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminPersonId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Changed status for ${account?.email ?? personId}: ${before?.status ?? "Unknown"} → ${status}`,
  });

  revalidatePath("/admin/users");
}

export async function revokeInvitation(email: string) {
  const { supabase, personId: adminPersonId, actorLabel } = await requireAdmin();

  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await supabase
    .from("invited_users")
    .delete()
    .eq("email", normalizedEmail);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminPersonId,
    actorLabel,
    module: "admin",
    action: "DELETED",
    details: `Revoked pending invitation for ${normalizedEmail}`,
  });

  revalidatePath("/admin/users");
}
