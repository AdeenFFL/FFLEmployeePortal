import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/constants";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = "Unknown user";
  let roleName = "Pending";

  if (user) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("person_id, email, persons(full_name)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    displayName = account?.persons?.full_name ?? account?.email ?? user.email ?? "Unknown user";

    if (account?.person_id) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("person_id", account.person_id);
      const names = (roleRows ?? []).map((r) => r.roles?.name).filter(Boolean);
      roleName = names[0] ?? "Pending";
    }
  }

  const isInactive = reason === "inactive";

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-md">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
        </span>

        <h1 className="mt-4 text-lg font-semibold text-slate-900">
          {isInactive
            ? "Your account has been deactivated"
            : "Access Denied"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isInactive
            ? "Contact your administrator if you believe this is a mistake."
            : "You do not have the required permissions to view this page or perform this action."}
        </p>

        <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-left text-sm">
          <p className="text-slate-500">
            Signed in as{" "}
            <span className="font-medium text-slate-800">{displayName}</span>
          </p>
          <p className="text-slate-500">
            Role: <span className="font-medium text-slate-800">{roleName}</span>
          </p>
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Contact Administrator
          </a>
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
