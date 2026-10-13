"use client";

import { useState, useTransition } from "react";
import { useDismissable } from "@/components/use-dismissable";
import { XIcon } from "@/components/icons";
import type { Role, UserStatus, AuthMethod, EmploymentType } from "@/types/database";
import { inviteOrUpdateUser, setUserPassword } from "./actions";

type UserFormValues = {
  id: string | null;
  email: string;
  display_name: string | null;
  role_id: string | null;
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

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function UserFormPanel({
  mode,
  roles,
  initialValues,
}: {
  mode: "new" | "edit";
  roles: Role[];
  initialValues: UserFormValues;
}) {
  const { visible, close } = useDismissable("/admin/users");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!visible) return null;

  // Thrown errors from a Server Action bound directly to a <form action> bubble up to Next's
  // nearest error boundary — in dev that's the full-page red "Runtime Error" overlay, for what
  // should be an inline "you missed a field" message. Submitting through onSubmit + a transition
  // instead lets the error be caught here and shown the same way every other form in this app
  // already does it (see login/page.tsx, role-permissions-editor.tsx).
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await inviteOrUpdateUser(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
      <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto rounded-l-xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {mode === "new" ? "Add New User" : "Edit User"}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Display Name</span>
            <input
              name="display_name"
              defaultValue={initialValues.display_name ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              required
              defaultValue={initialValues.email}
              // readOnly, NOT disabled: a disabled field is excluded from FormData entirely on
              // submit, which was silently dropping the email and tripping the server's "Email
              // and Role are required" check even with a role selected. readOnly still blocks
              // editing but keeps the value in the submission.
              readOnly={mode === "edit"}
              className={`${inputClass} ${mode === "edit" ? "bg-slate-100 text-slate-500" : ""}`}
            />
            {mode === "edit" && (
              <span className="text-xs text-slate-400">
                Tied to their sign-in identity — not editable.
              </span>
            )}
          </label>

          {mode === "new" ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Sign-in Method</span>
                <select name="auth_method" defaultValue="microsoft" className={inputClass}>
                  <option value="microsoft">Microsoft (invite)</option>
                  <option value="password">Email &amp; Password</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Initial Password</span>
                <input
                  name="password"
                  type="password"
                  minLength={6}
                  autoComplete="new-password"
                  className={inputClass}
                />
                <span className="text-xs text-slate-400">
                  Only used if Sign-in Method is Email &amp; Password. Minimum 6 characters.
                  There is no email delivery in this system — you must share this password with
                  the employee directly (verbally, chat, etc.) after saving.
                </span>
              </label>
            </>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Sign-in Method</span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                {initialValues.auth_method === "password" ? "Email & Password" : "Microsoft"}
              </span>
              <span className="text-xs text-slate-400">
                Fixed at account creation — cannot be changed.
              </span>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Role</span>
            <select
              name="role_id"
              required
              defaultValue={initialValues.role_id ?? ""}
              className={inputClass}
            >
              <option value="" disabled>
                Select a role
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Employment Type</span>
            <select
              name="employment_type"
              defaultValue={initialValues.employment_type ?? ""}
              className={inputClass}
            >
              <option value="">— Select —</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Employee ID</span>
            <input
              name="employee_code"
              defaultValue={initialValues.employee_code ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Designation</span>
            <input
              name="designation"
              defaultValue={initialValues.designation ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Date of Joining</span>
            <input
              name="date_of_joining"
              type="date"
              defaultValue={initialValues.date_of_joining ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Status</span>
            <select
              name="status"
              defaultValue={initialValues.status}
              className={inputClass}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Suspended">Suspended</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea
              name="notes"
              defaultValue={initialValues.notes ?? ""}
              rows={3}
              className={inputClass}
            />
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>

        {mode === "edit" && initialValues.auth_method === "password" && initialValues.id && (
          <form
            action={setUserPassword.bind(null, initialValues.id)}
            className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6"
          >
            <h3 className="text-sm font-semibold text-slate-900">Set New Password</h3>
            <p className="text-xs text-slate-400">
              There is no self-service reset email. Set a new password here and communicate it
              to the employee directly.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">New Password</span>
              <input
                name="new_password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Set New Password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
