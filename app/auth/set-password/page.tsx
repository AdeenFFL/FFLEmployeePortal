"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const MIN_PASSWORD_LENGTH = 6;

// Landing page for the recovery link lib/email/invite.ts's sendAccountSetupEmail sends
// (generated via supabase.auth.admin.generateLink({ type: "recovery" })). Supabase's own
// /auth/v1/verify endpoint establishes a session from the link's hash-fragment tokens before
// redirecting here — supabase-js's browser client auto-detects that (detectSessionInUrl, the
// default), so by the time this component mounts there's already a session; this just lets them
// replace the password nobody chose with one only they know.
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // The recovery session is established client-side from the URL hash; there's no reliable
    // single "ready" event across all supabase-js versions, so just confirm a session exists.
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setError("This link has expired or already been used. Ask IT to resend it.");
      }
      setReady(true);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // proxy.ts routes them correctly from here (/home, /pending-setup, etc.) based on their
    // actual account state — no need to duplicate that logic here.
    router.push("/");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-md">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-500">{APP_TAGLINE}</p>
        </div>

        <h2 className="mb-1 text-base font-semibold text-slate-900">Set your password</h2>
        <p className="mb-4 text-sm text-slate-500">
          Choose a password only you know to finish setting up your account.
        </p>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {ready && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">New password</span>
              <input
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Confirm password</span>
              <input
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Set password and sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
