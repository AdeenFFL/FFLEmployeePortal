"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// One guard for every form in the portal: once a form is submitted it is locked until its server
// action has finished, so a double (or triple) click on Save / Submit can't send it twice and
// create two tickets, two demands, two payments… Mounted once in app/(protected)/layout.tsx.
//
// How: a capture-phase "submit" listener on window runs before React's own listener (React
// listens on the document, which Next hydrates as its root), so a
// second submit of a locked form is stopped before React ever sees it. The lock comes off when
// the action's request has finished (Next sends server actions as a fetch with a "Next-Action"
// header, counted below), when the page URL changes (the action redirected), or, if no action
// started at all (e.g. the form's own validation stopped it), straight away.
//
// Plain GET forms (search / filter bars) are left alone. A form that must allow quick repeated
// submits can opt out with data-allow-resubmit.

const LOCKED = "data-submitting";
const NO_ACTION_UNLOCK_MS = 800; // nothing was sent: unlock
const AFTER_ACTION_UNLOCK_MS = 1000; // action done: give a redirect time to land first
const MAX_LOCK_MS = 120_000; // never stay stuck

const SLOW_SAVE_MS = 20_000; // a save still running after this gets a "still saving" message

// Picked up by components/form-feedback.tsx.
export const SAVE_PROBLEM_EVENT = "portal:save-problem";
export type SaveProblem = { kind: "error" | "slow" | "done"; message: string };
function reportSaveProblem(kind: SaveProblem["kind"], message: string) {
  window.dispatchEvent(new CustomEvent<SaveProblem>(SAVE_PROBLEM_EVENT, { detail: { kind, message } }));
}

type Lock ={ form: HTMLFormElement; sawAction: boolean; timers: number[] };
const locks = new Set<Lock>();
let actionsInFlight = 0;
let fetchPatched = false;

function unlock(lock: Lock) {
  lock.timers.forEach((t) => window.clearTimeout(t));
  lock.form.removeAttribute(LOCKED);
  lock.form.removeAttribute("aria-busy");
  locks.delete(lock);
}

function unlockAll() {
  [...locks].forEach(unlock);
}

function isServerAction(init?: RequestInit) {
  if (!init?.headers) return false;
  try {
    return new Headers(init.headers).has("next-action");
  } catch {
    return false;
  }
}

function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isServerAction(init)) return original(input, init);
    actionsInFlight++;
    locks.forEach((l) => (l.sawAction = true));
    // Tell the user (components/form-feedback.tsx) when a save is slow or didn't go through, so a
    // failure never looks like success.
    const slowTimer = window.setTimeout(() => {
      reportSaveProblem("slow", "Still saving… this is taking longer than usual. Please wait before trying again.");
    }, SLOW_SAVE_MS);
    const settle = () => {
      window.clearTimeout(slowTimer);
      reportSaveProblem("done", "");
      actionsInFlight = Math.max(0, actionsInFlight - 1);
      if (actionsInFlight > 0) return;
      for (const lock of locks) {
        if (lock.sawAction) lock.timers.push(window.setTimeout(() => unlock(lock), AFTER_ACTION_UNLOCK_MS));
      }
    };
    return original(input, init).then(
      (res) => {
        settle();
        if (!res.ok) {
          reportSaveProblem(
            "error",
            `Not saved: the server had a problem (error ${res.status}). Please try again, and tell IT if it keeps happening.`,
          );
        }
        return res;
      },
      (err) => {
        settle();
        reportSaveProblem("error", "Not saved: couldn't reach the server. Check your connection and try again.");
        throw err;
      },
    );
  };
}

function onSubmit(event: Event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if ((form.getAttribute("method") ?? "").toLowerCase() === "get") return;
  if (form.hasAttribute("data-allow-resubmit")) return;

  if (form.hasAttribute(LOCKED)) {
    // Already being saved: drop this submit entirely.
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  form.setAttribute(LOCKED, "");
  form.setAttribute("aria-busy", "true");
  const lock: Lock = { form, sawAction: actionsInFlight > 0, timers: [] };
  locks.add(lock);
  lock.timers.push(
    window.setTimeout(() => {
      if (!lock.sawAction) unlock(lock);
    }, NO_ACTION_UNLOCK_MS),
    window.setTimeout(() => unlock(lock), MAX_LOCK_MS),
  );
}

export function SubmitGuard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    patchFetch();
    window.addEventListener("submit", onSubmit, true);
    return () => window.removeEventListener("submit", onSubmit, true);
  }, []);

  // A redirect (?notice= / ?error= or a new page) means the action is over.
  useEffect(() => {
    unlockAll();
  }, [pathname, searchParams]);

  return null;
}
