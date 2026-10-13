"use client";

import { createContext, useContext } from "react";
import { useDismissable } from "@/components/use-dismissable";
import { XIcon } from "@/components/icons";

const ModalCloseContext = createContext<(() => void) | null>(null);

// For a Cancel button living inside a Modal's children (e.g. org-unit-form.tsx) to close the
// same overlay instance the header's ✕ closes, instead of each having its own independent
// (and therefore inconsistent) idea of "open".
export function useModalClose() {
  const close = useContext(ModalCloseContext);
  if (!close) throw new Error("useModalClose must be called within a Modal");
  return close;
}

export function Modal({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: string;
  children: React.ReactNode;
}) {
  const { visible, close } = useDismissable(closeHref);
  if (!visible) return null;

  return (
    <ModalCloseContext.Provider value={close}>
      <div className="fixed inset-0 z-20 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
        <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={close}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Close"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalCloseContext.Provider>
  );
}
