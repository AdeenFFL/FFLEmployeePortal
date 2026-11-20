"use client";

import { useEffect, useState } from "react";

export const LIVE_SEARCH_MIN = 2;
const DELAY_MS = 300;

type SearchResult<T> = { error: string | null; people: T[] };

// Search as you type for the clearance people pickers (same recipe as the IT Inventory person
// picker): 2+ letters, a short pause after the last key, and an answer for an older text is
// dropped. `search` must be a stable function (a Server Action import is).
export function useLiveSearch<T>(query: string, search: (q: string) => Promise<SearchResult<T>>) {
  const term = query.trim();
  const active = term.length >= LIVE_SEARCH_MIN;
  // The answer is stored with the text it belongs to, so a stale answer is never shown.
  const [answer, setAnswer] = useState<{ term: string; people: T[] | null; error: string | null }>({
    term: "",
    people: null,
    error: null,
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await search(term);
        if (!cancelled) {
          setAnswer({ term, people: result.error ? null : result.people, error: result.error });
        }
      } catch {
        if (!cancelled) {
          setAnswer({ term, people: null, error: "Something went wrong. Please try again." });
        }
      }
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, term, search]);

  const current = active && answer.term === term;
  return {
    results: current ? answer.people : null,
    error: current ? answer.error : null,
    searching: active && !current,
    // 1 letter typed: show a hint instead of searching.
    tooShort: term.length > 0 && !active,
  };
}
