import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { KeyIcon } from "@/components/icons";

// Static — no Supabase client needed, and deliberately so: this page's entire audience is
// someone who cannot authenticate at all. There is no real password-reset-email flow in this
// system (no configured email provider), so resets are admin-mediated, not self-service.
export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-md">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <KeyIcon className="h-6 w-6" />
        </span>

        <h1 className="mt-4 text-lg font-semibold text-slate-900">
          Forgot your password?
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Password resets aren&apos;t self-service. Contact your administrator and they can set
          a new password for your account.
        </p>

        <div className="mt-6 flex justify-center gap-3">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Contact Administrator
          </a>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
