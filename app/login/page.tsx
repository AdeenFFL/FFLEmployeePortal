"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { recordPasswordLogin } from "./actions";
import { MicrosoftLogoIcon } from "@/components/icons";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Sign-in did not complete. Please try again.",
  auth_failed: "We couldn't sign you in. Please try again.",
  provisioning_failed:
    "We couldn't set up your account. Please contact your administrator.",
};

function LoginError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error) return null;

  return (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
    </p>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function signInWithMicrosoft() {
    setIsRedirecting(true);
    const supabase = createClient();
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        scopes: "email",
      },
    });

    if (error) setIsRedirecting(false);
  }

  async function handlePasswordSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError(null);
    setIsSigningIn(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setPasswordError("Incorrect email or password.");
        setIsSigningIn(false);
        return;
      }

      // Best-effort — genuinely never blocks sign-in if it fails, unlike before.
      try {
        await recordPasswordLogin();
      } catch {
        // ignore — last_login_at just won't update this time
      }

      // proxy.ts redirects an authenticated, role-assigned user hitting "/" to their role home —
      // same mechanism already used for "/login" itself and "/pending-setup".
      router.push("/");
      router.refresh();
    } catch {
      setPasswordError("Something went wrong. Please try again.");
      setIsSigningIn(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-50 px-4 py-16">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logos/ffl-logo-blue.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto h-[34rem] w-[34rem] max-w-none object-contain opacity-[0.06]"
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex items-center justify-center gap-4">
            {/* The three main companies under the Fauji Food Vertical. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/ffl-logo-blue.jpg"
              alt="Fauji Foods Limited"
              className="h-10 w-10 rounded-md object-contain"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/fresh-n-freeze-logo.png"
              alt="Fauji Fresh n Freeze"
              className="h-10 w-10 object-contain"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/fauji-cereals-logo.png"
              alt="Fauji Cereals"
              className="h-10 w-10 object-contain"
            />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-500">{APP_TAGLINE}</p>
          <p className="mt-2 text-xs text-slate-400">Sign in to continue</p>
        </div>

        <Suspense fallback={null}>
          <LoginError />
        </Suspense>

        <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Email Address</span>
            <input
              type="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">Password</span>
              <Link href="/forgot-password" className="text-xs text-blue-600 hover:underline">
                Forgot Password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          {passwordError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {passwordError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSigningIn}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {isSigningIn ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium uppercase text-slate-400">Or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div>
          <button
            type="button"
            onClick={signInWithMicrosoft}
            disabled={isRedirecting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            <MicrosoftLogoIcon className="h-4 w-4 shrink-0" />
            {isRedirecting ? "Redirecting…" : "Sign in with Microsoft"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Developed by IT FFL</p>
      </div>
    </div>
  );
}
