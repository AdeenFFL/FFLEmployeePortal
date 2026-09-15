"use client";

import { useState } from "react";

// Every admin overlay (Modal, the user-form side panel) is a Server Component conditionally
// rendered off a URL search param (?edit=X) — closing it by navigating to a plain Link means
// Next.js re-runs the WHOLE page's data fetching (several sequential Supabase calls on pages
// like /admin/users) just to make the overlay disappear, which is what made closing feel
// sluggish. Closing doesn't need any of that data — it just needs the overlay gone.
//
// `close()` hides the overlay immediately via local state (zero network dependency) and
// separately syncs the address bar with plain history.replaceState — NOT router.push/replace,
// which would still trigger a Next.js navigation and re-fetch. This keeps refresh/back-button
// behavior correct (loading `closeHref` directly renders the list with no overlay) without ever
// blocking the close on a server round trip.
export function useDismissable(closeHref: string) {
  const [visible, setVisible] = useState(true);

  function close() {
    setVisible(false);
    window.history.replaceState(null, "", closeHref);
  }

  return { visible, close };
}
