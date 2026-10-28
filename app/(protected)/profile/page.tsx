import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/require-user";
import { updateOwnBiodata, changeOwnPassword } from "./actions";
import { PageHeader } from "@/components/page-header";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function initialsFor(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const { supabase, personId } = await requireActiveUser();

  // Explicit FK hints (companies!persons_company_id_fkey, not just companies(...)) so PostgREST
  // never has to auto-discover which relationship to embed — a stale schema cache (e.g. right
  // after a raw DDL change outside the normal migration flow) can otherwise report "more than
  // one relationship was found" even when only one FK actually exists.
  const { data: profile, error: profileError } = await supabase
    .from("persons")
    .select("*, companies!persons_company_id_fkey(name), org_units!persons_site_id_fkey(name)")
    .eq("id", personId)
    .single();

  // requireActiveUser() above already confirmed this exact person's row is Active via its own
  // query on the same session, so a failure here should never be a genuinely missing row — swallowing
  // the real Supabase/PostgREST error (RLS denial, embed failure, etc.) behind a generic message
  // made this unnecessarily hard to diagnose the one time it did happen. Surface it instead.
  if (!profile) {
    throw new Error(profileError ? `Could not load your profile: ${profileError.message}` : "Profile not found.");
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("email, auth_method")
    .eq("person_id", personId)
    .single();

  const name = profile.full_name ?? account?.email;
  const subtitle = [profile.designation, profile.org_units?.name].filter(Boolean).join(" · ");
  const editingPersonal = edit === "personal";

  return (
    <div className="mx-auto max-w-5xl py-6">
      <PageHeader title="My Profile" description="View and manage your personal details." />

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-full shrink-0 md:w-72">
          <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-blue-100 text-2xl font-semibold text-blue-700">
              {initialsFor(name)}
            </div>
            <p className="mt-4 text-base font-bold text-slate-900">{name}</p>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Personal Information
              </h2>
              {!editingPersonal && (
                <Link
                  href="/profile?edit=personal"
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  Edit
                </Link>
              )}
            </div>

            {editingPersonal ? (
              <form action={updateOwnBiodata} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Name</span>
                  <input
                    name="display_name"
                    defaultValue={profile.full_name ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">CNIC</span>
                  <input
                    name="cnic"
                    defaultValue={profile.cnic ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Date of Birth</span>
                  <input
                    name="date_of_birth"
                    type="date"
                    defaultValue={profile.date_of_birth ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Address</span>
                  <input
                    name="address"
                    defaultValue={profile.address ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Name</span>
                  <input
                    name="emergency_contact_name"
                    defaultValue={profile.emergency_contact_name ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Phone</span>
                  <input
                    name="emergency_contact_phone"
                    defaultValue={profile.emergency_contact_phone ?? ""}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <Link
                    href="/profile"
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </Link>
                </div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-slate-800">{profile.full_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">CNIC</dt>
                  <dd className="font-medium text-slate-800">{profile.cnic ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Date of Birth</dt>
                  <dd className="font-medium text-slate-800">
                    {formatDate(profile.date_of_birth)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="font-medium text-slate-800">{profile.address ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Emergency Contact Name</dt>
                  <dd className="font-medium text-slate-800">
                    {profile.emergency_contact_name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Emergency Contact Phone</dt>
                  <dd className="font-medium text-slate-800">
                    {profile.emergency_contact_phone ?? "—"}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Employment Information
            </h2>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Employee ID</dt>
                <dd className="font-medium text-slate-800">{profile.employee_code ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Company</dt>
                <dd className="font-medium text-slate-800">{profile.companies?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Designation</dt>
                <dd className="font-medium text-slate-800">{profile.designation ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Site</dt>
                <dd className="font-medium text-slate-800">{profile.org_units?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Date of Joining</dt>
                <dd className="font-medium text-slate-800">
                  {formatDate(profile.date_of_joining)}
                </dd>
              </div>
            </dl>
          </div>

          {account?.auth_method === "password" && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Change Password
              </h2>
              <form action={changeOwnPassword} className="flex max-w-md flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">New Password</span>
                  <input
                    name="new_password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Confirm New Password</span>
                  <input
                    name="confirm_password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <div>
                  <button
                    type="submit"
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Update Password
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
