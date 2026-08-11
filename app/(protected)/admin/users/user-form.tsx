import Link from "next/link";
import type { Role, UserStatus, AuthMethod } from "@/types/database";
import { inviteOrUpdateUser, setUserPassword } from "./actions";

type UserFormValues = {
  id: string | null;
  email: string;
  display_name: string | null;
  role_id: string | null;
  department: string | null;
  site: string | null;
  status: UserStatus;
  notes: string | null;
  employee_code: string | null;
  designation: string | null;
  date_of_joining: string | null;
  auth_method: AuthMethod;
};

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function UserFormPanel({
  mode,
  roles,
  departmentOptions,
  siteOptions,
  initialValues,
}: {
  mode: "new" | "edit";
  roles: Role[];
  departmentOptions: string[];
  siteOptions: string[];
  initialValues: UserFormValues;
}) {
  return (
    <div className="fixed inset-0 z-10">
      <div className="absolute inset-0 bg-slate-900/40" />
      <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto rounded-l-xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {mode === "new" ? "Add New User" : "Edit User"}
          </h2>
          <Link
            href="/admin/users"
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Close
          </Link>
        </div>

        <form action={inviteOrUpdateUser} className="flex flex-col gap-4">
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
              readOnly={mode === "edit"}
              disabled={mode === "edit"}
              className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
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
            <span className="font-medium text-slate-700">Department</span>
            <select
              name="department"
              defaultValue={initialValues.department ?? ""}
              className={inputClass}
            >
              <option value="">— None —</option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {initialValues.department &&
                !departmentOptions.includes(initialValues.department) && (
                  <option value={initialValues.department}>
                    {initialValues.department} (inactive)
                  </option>
                )}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Site</span>
            <select
              name="site"
              defaultValue={initialValues.site ?? ""}
              className={inputClass}
            >
              <option value="">— None —</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {initialValues.site && !siteOptions.includes(initialValues.site) && (
                <option value={initialValues.site}>{initialValues.site} (inactive)</option>
              )}
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
            <Link
              href="/admin/users"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save
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
