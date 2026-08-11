import Link from "next/link";

export function Modal({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" />
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <Link
            href={closeHref}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
