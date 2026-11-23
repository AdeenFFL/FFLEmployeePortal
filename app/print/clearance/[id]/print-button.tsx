"use client";

// Opens the browser's print dialog (Print, or "Save as PDF" as the printer).
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Print / Save as PDF
    </button>
  );
}
