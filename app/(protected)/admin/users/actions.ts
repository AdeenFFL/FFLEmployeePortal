"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit/log";
import type { UserStatus, AuthMethod } from "@/types/database";

const MIN_PASSWORD_LENGTH = 6; // Supabase's own GoTrue default minimum

function readUserFormFields(formData: FormData) {
  return {
    display_name: String(formData.get("display_name") ?? "").trim() || null,
    role_id: String(formData.get("role_id") ?? ""),
    department: String(formData.get("department") ?? "").trim() || null,
    site: String(formData.get("site") ?? "").trim() || null,
    status: (String(formData.get("status") ?? "Active") as UserStatus) ?? "Active",
    notes: String(formData.get("notes") ?? "").trim() || null,
    employee_code: String(formData.get("employee_code") ?? "").trim() || null,
    designation: String(formData.get("designation") ?? "").trim() || null,
    date_of_joining: String(formData.get("date_of_joining") ?? "").trim() || null,
  };
}

export async function inviteOrUpdateUser(formData: FormData) {
  const { supabase, adminProfileId, actorLabel } = await requireAdmin();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fields = readUserFormFields(formData);

  if (!email || !fields.role_id) {
    throw new Error("Email and Role are required.");
  }

  // Re-derive new-vs-edit from a trusted server read, not a client-supplied flag.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    // Editing a real user — email itself stays tied to their identity, not editable here.
    // Sign-in method is fixed at creation — the submitted auth_method (if any) is deliberately
    // never read on this branch.
    const { error } = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", existingProfile.id);
    if (error) throw new Error(error.message);
    await logAuditEvent({
      supabase,
      actorId: adminProfileId,
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

    const { error: profileError } = await supabase.from("profiles").insert({
      id: newUserId,
      email,
      auth_method: "password",
      ...fields,
    });

    if (profileError) {
      // Roll back — otherwise this is a real, working login with no profile row behind it.
      await admin.auth.admin.deleteUser(newUserId);
      throw new Error(profileError.message);
    }

    await logAuditEvent({
      supabase,
      actorId: adminProfileId,
      actorLabel,
      module: "admin",
      action: "CREATED",
      details: `Created password-based account for ${email} as ${role?.name ?? "Unknown role"}`,
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

  const { error } = await supabase
    .from("invited_users")
    .upsert({ email, ...fields }, { onConflict: "email" });
  if (error) throw new Error(error.message);

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", fields.role_id)
    .maybeSingle();

  await logAuditEvent({
    supabase,
    actorId: adminProfileId,
    actorLabel,
    module: "admin",
    action: existingInvite ? "MODIFIED" : "CREATED",
    details: existingInvite
      ? `Updated pending invitation for ${email}`
      : `Invited new user ${email} as ${role?.name ?? "Unknown role"}`,
  });

  revalidatePath("/admin/users");
}

// Decision: since "contact your administrator" is the only recovery path (no email flow), the
// Admin must be able to set a new password for an existing password-auth user.
export async function setUserPassword(profileId: string, formData: FormData) {
  const { supabase, adminProfileId, actorLabel } = await requireAdmin();

  const newPassword = String(formData.get("new_password") ?? "");
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, auth_method")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) throw new Error("User not found.");
  if (profile.auth_method !== "password") {
    throw new Error("This account signs in with Microsoft — there is no password to reset.");
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(profileId, {
    password: newPassword,
  });
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminProfileId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Reset password for ${profile.email}`, // never log the password itself
  });

  revalidatePath("/admin/users");
}

export async function setUserStatus(profileId: string, status: UserStatus) {
  const { supabase, adminProfileId, actorLabel } = await requireAdmin();

  if (profileId === adminProfileId) {
    throw new Error("You cannot deactivate your own account.");
  }

  // Fetch the current values fresh (not passed from the caller/page) — a page-render-time
  // value could be stale by the time this actually submits.
  const { data: before } = await supabase
    .from("profiles")
    .select("email, status")
    .eq("id", profileId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", profileId);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminProfileId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Changed status for ${before?.email ?? profileId}: ${before?.status ?? "Unknown"} → ${status}`,
  });

  revalidatePath("/admin/users");
}

export async function revokeInvitation(email: string) {
  const { supabase, adminProfileId, actorLabel } = await requireAdmin();

  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await supabase
    .from("invited_users")
    .delete()
    .eq("email", normalizedEmail);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: adminProfileId,
    actorLabel,
    module: "admin",
    action: "DELETED",
    details: `Revoked pending invitation for ${normalizedEmail}`,
  });

  revalidatePath("/admin/users");
}
