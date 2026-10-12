import Link from "next/link";
import { ChatIcon } from "@/components/icons";

// Floating chat-style entry point to the public, no-login anonymous feedback flow (app/feedback).
// Deliberately NOT gated by anything — /feedback itself is a public route (see proxy.ts's
// PUBLIC_PATHS), reachable with or without an account.
export function AnonymousFeedbackFab() {
  return (
    <div className="fixed bottom-6 right-6 z-20 flex flex-col items-end">
      <div className="animate-gentle-bounce flex flex-col items-end">
        <div className="mb-1 mr-6 max-w-40 rounded-2xl rounded-br-sm bg-white px-3.5 py-2.5 text-center text-xs font-semibold text-slate-700 shadow-lg ring-1 ring-slate-900/10">
          Submit anonymous feedback without logging in
        </div>
        {/* Box width matches the button below (h-14 w-14) and both are right-aligned in the
            same column, so the curve's endpoint — centered in this box — lands exactly on the
            button's center rather than drifting past its edge. */}
        <svg
          viewBox="0 0 56 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-3 h-7 w-14 text-blue-500"
          aria-hidden="true"
        >
          {/* Curve ends at (28,23); both arrowhead wings start FROM that exact point, angled to
              flank the curve's tangent direction there — so the head reads as one continuous
              stroke with the curve instead of a disconnected shape bolted on nearby. */}
          <path d="M10 4c2 11 10 16 18 19" />
          <path d="M28 23 20 25M28 23 23 16" />
        </svg>
      </div>
      <Link
        href="/feedback"
        title="Submit anonymous feedback without logging in"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg ring-4 ring-blue-100 transition-transform hover:scale-110"
      >
        <ChatIcon className="h-6 w-6" />
      </Link>
    </div>
  );
}
