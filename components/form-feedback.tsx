"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SAVE_PROBLEM_EVENT, type SaveProblem } from "@/components/submit-guard";

// One pop-up for every page, so a save never silently fails (mounted once in
// app/(protected)/layout.tsx):
//   - the ?notice= / ?error= message every server action redirects with (also read out of a
//     malformed URL, so a message is never lost the way the onboarding form's once was);
//   - a save that couldn't reach the server, or that the server crashed on (from SubmitGuard);
//   - a save that is taking unusually long;
//   - an error thrown by a client-side save that nothing else caught.
// Success messages close by themselves; errors stay until closed.

type Toast = { id: number; tone: "error" | "notice" | "slow"; message: string };

const NOTICE_MS = 6000;
let nextId = 1;

function messageFromUrl(kind: "error" | "notice", searchParams: URLSearchParams) {
  const direct = searchParams.get(kind);
  if (direct) return direct;
  // e.g. /x?kind=A?error=… : the message hides inside another parameter's value.
  const match = window.location.search.match(new RegExp(`[?&]${kind}=([^&#]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return match[1];
  }
}

export function FormFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shownRef = useRef<string | null>(null);

  function push(tone: Toast["tone"], message: string) {
    const id = nextId++;
    setToasts((list) => [...list.filter((t) => t.message !== message && (tone !== "slow" || t.tone !== "slow")), { id, tone, message }]);
    if (tone === "notice") window.setTimeout(() => dismiss(id), NOTICE_MS);
  }

  function dismiss(id: number) {
    setToasts((list) => list.filter((t) => t.id !== id));
  }

  // Messages carried in the URL after a server action redirect.
  useEffect(() => {
    const error = messageFromUrl("error", searchParams);
    const notice = messageFromUrl("notice", searchParams);
    const key = `${pathname}?${searchParams.toString()}`;
    if ((!error && !notice) || shownRef.current === key) return;
    shownRef.current = key;
    // Deferred so it isn't a state update inside the effect's own render pass.
    const t = window.setTimeout(() => {
      setToasts((list) => list.filter((x) => x.tone !== "slow"));
      if (error) push("error", error);
      if (notice) push("notice", notice);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    function onProblem(e: Event) {
      const { kind, message } = (e as CustomEvent<SaveProblem>).detail;
      if (kind === "done") setToasts((list) => list.filter((t) => t.tone !== "slow"));
      else push(kind === "slow" ? "slow" : "error", message);
    }
    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason as { message?: string; digest?: string } | undefined;
      const message = reason?.message ?? "";
      // Next's own control flow (redirect / not found) isn't an error.
      if (!message || reason?.digest?.startsWith("NEXT_") || message.startsWith("NEXT_")) return;
      push("error", `Not saved: ${message}`);
    }
    window.addEventListener(SAVE_PROBLEM_EVENT, onProblem);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener(SAVE_PROBLEM_EVENT, onProblem);
      window.removeEventListener("unhandledrejection", onRejection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-96">
      {toasts.map((t) => {
        const style =
          t.tone === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : t.tone === "slow"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-800";
        const title = t.tone === "error" ? "Not saved" : t.tone === "slow" ? "Still saving" : "Saved";
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full rounded-lg border px-4 py-3 text-sm shadow-lg ${style}`}
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5 font-bold">
                {t.tone === "error" ? "!" : t.tone === "slow" ? "…" : "✓"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="mt-0.5 break-words">{t.message.replace(/^Not saved: /, "")}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Close"
                className="-mr-1 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
