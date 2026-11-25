"use client";

import { useState, useTransition } from "react";
import { useDismissable } from "@/components/use-dismissable";
import { XIcon } from "@/components/icons";
import { getInitials } from "@/lib/format/initials";
import type { Role, UserStatus, AuthMethod, EmploymentType } from "@/types/database";
import { inviteOrUpdateUser, setUserPassword } from "./actions";

type UserFormValues = {
  id: string | null;
  email: string;
  display_name: string | null;
  role_id: string | null;
  department_id: string | null;
  site_id: string | null;
  status: UserStatus;
  notes: string | null;
  employee_code: string | null;
  designation: string | null;
  date_of_joining: string | null;
  employment_type: EmploymentType | null;
  auth_method: AuthMethod;
};

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "contractual_with_email", label: "Contractual — with official email" },
  { value: "contractual_no_email", label: "Contractual — no official email" },
  { value: "third_party_vendor", label: "3rd-party / Vendor" },
];

const STATUSES: UserStatus[] = ["Active", "Inactive", "Suspended"];

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function Field({
  label,
  hint,
  required,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

// Add / edit a user: a centred dialog with the everyday fields up front and the rest under
// "More details". Field names are unchanged, so inviteOrUpdateUser (actions.ts) works as before.
export function UserFormPanel({
  mode,
  roles,
  departments,
  sites,
  initialValues,
}: {
  mode: "new" | "edit";
  roles: Role[];
  departments: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  initialValues: UserFormValues;
}) {
  const { visible, close } = useDismissable("/admin/users");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [authMethod, setAuthMethod] = useState<AuthMethod>("microsoft");
  const [status, setStatus] = useState<UserStatus>(initialValues.status);

  if (!visible) return null;

  const isInvite = mode === "edit" && initialValues.id === null;
  const hasMoreDetails = Boolean(
    initialValues.employee_code ||
      initialValues.employment_type ||
      initialValues.date_of_joining ||
      initialValues.notes,
  );

  // Thrown errors from a Server Action bound directly to a <form action> bubble up to Next's
  // nearest error boundary — in dev that's the full-page red "Runtime Error" overlay, for what
  // should be an inline "you missed a field" message. Submitting through onSubmit + a transition
  // instead lets the error be caught here and shown inline.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        setNotice(await inviteOrUpdateUser(formData));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  const title = mode === "new" ? "Add user" : isInvite ? "Edit invite" : "Edit user";
  const display = initialValues.display_name || initialValues.email;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {mode === "edit" && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {getInitials(display)}
              </span>
            )}
            <div className="min-w-0">
              <h2 id="user-form-title" className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              {mode === "edit" ? (
                <p className="truncate text-sm text-slate-500">
                  {initialValues.email} ·{" "}
                  {initialValues.auth_method === "password" ? "Email & password" : "Microsoft sign-in"}
                </p>
              ) : (
                <p className="text-sm text-slate-500">They can sign in once this is saved.</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <form id="user-form" onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {notice && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {mode === "new" ? (
            <>
              <Field label="Email" required>
                <input
                  name="email"
                  type="email"
                  required
                  autoFocus
                  placeholder="name@faujifoods.com"
                  defaultValue={initialValues.email}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Sign-in</span>
                <input type="hidden" name="auth_method" value={authMethod} />
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "microsoft", title: "Microsoft", hint: "Invite email; company account" },
                      { value: "password", title: "Email & password", hint: "You set the first password" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setAuthMethod(o.value)}
                      aria-pressed={authMethod === o.value}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        authMethod === o.value
                          ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-sm font-medium text-slate-900">{o.title}</span>
                      <span className="block text-xs text-slate-500">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              {authMethod === "password" && (
                <Field
                  label="First password"
                  hint="At least 6 characters. Share it with them yourself; no email is sent."
                >
                  <input name="password" type="password" minLength={6} autoComplete="new-password" className={inputClass} />
                </Field>
              )}
            </>
          ) : (
            // Kept in the submission (the email identifies who is being saved), not editable.
            <input type="hidden" name="email" value={initialValues.email} />
          )}

          <Field label="Display name">
            <input
              name="display_name"
              defaultValue={initialValues.display_name ?? ""}
              placeholder="e.g. Ahmed Javed"
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" required>
              <select name="role_id" required defaultValue={initialValues.role_id ?? ""} className={inputClass}>
                <option value="" disabled>
                  Select a role
                </option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select name="department_id" defaultValue={initialValues.department_id ?? ""} className={inputClass}>
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Pending Microsoft invites can't carry a site yet (invited_users has no site_id). */}
            {!isInvite && (
              <Field label="Site">
                <select name="site_id" defaultValue={initialValues.site_id ?? ""} className={inputClass}>
                  <option value="">None</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Designation" className={isInvite ? "sm:col-span-2" : ""}>
              <input
                name="designation"
                defaultValue={initialValues.designation ?? ""}
                placeholder="e.g. IT Officer"
                className={inputClass}
              />
            </Field>
          </div>

          {/* Status */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <input type="hidden" name="status" value={status} />
            <div role="radiogroup" aria-label="Status" className="inline-flex rounded-lg bg-slate-100 p-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      s === "Active" ? "bg-emerald-500" : s === "Suspended" ? "bg-amber-500" : "bg-slate-400"
                    }`}
                  />
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* The rest, folded away */}
          <details open={mode === "new" || hasMoreDetails} className="group rounded-xl border border-slate-200">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              More details
              <span className="text-xs text-slate-400 group-open:hidden">Employee ID, joining date, notes…</span>
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Employee ID">
                  <input name="employee_code" defaultValue={initialValues.employee_code ?? ""} className={inputClass} />
                </Field>
                <Field label="Date of joining">
                  <input
                    name="date_of_joining"
                    type="date"
                    defaultValue={initialValues.date_of_joining ?? ""}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Employment type">
                <select name="employment_type" defaultValue={initialValues.employment_type ?? ""} className={inputClass}>
                  <option value="">Not set</option>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Notes">
                <textarea name="notes" defaultValue={initialValues.notes ?? ""} rows={2} className={inputClass} />
              </Field>
            </div>
          </details>
        </form>

        {/* Reset password: only for email & password users */}
        {mode === "edit" && initialValues.auth_method === "password" && initialValues.id && (
          <details className="border-t border-slate-100 px-6 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
              Set a new password
            </summary>
            <form action={setUserPassword.bind(null, initialValues.id)} className="mt-3 flex gap-2">
              <input
                name="new_password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="New password (6+ characters)"
                aria-label="New password"
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Set
              </button>
            </form>
            <p className="mt-1.5 text-xs text-slate-400">No reset email is sent; tell them the new password yourself.</p>
          </details>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="user-form"
            disabled={isPending}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Saving…" : mode === "new" ? "Add user" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
