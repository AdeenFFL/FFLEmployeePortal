import { SignOutButton } from "./sign-out-button";

export default function PendingSetupPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-md">
        <h1 className="text-lg font-semibold text-slate-900">
          Account pending setup
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account has been created and is awaiting role assignment by an
          administrator. You&apos;ll be able to access the portal once a role
          has been assigned.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Need this sooner? Contact your administrator.
        </p>
        <SignOutButton />
      </div>
    </div>
  );
}
