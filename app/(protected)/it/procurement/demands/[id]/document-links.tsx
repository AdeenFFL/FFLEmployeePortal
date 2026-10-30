import { formatBytes, formatDateTime } from "@/lib/it/tickets";
import type { ItDocument } from "@/types/database";

// Signed-URL links to procurement documents (it-documents bucket), shared by the delivery and
// invoice panels on the demand page.
export function DocumentLinks({ documents, urls }: { documents: ItDocument[]; urls: Map<string, string> }) {
  if (documents.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {documents.map((d) => {
        const url = urls.get(d.storage_path);
        return (
          <li key={d.id}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700"
              title={`${d.file_name} · ${formatBytes(d.size_bytes)} · ${formatDateTime(d.uploaded_at)}`}
            >
              <span className="font-medium">{d.doc_type}</span>
              <span className="max-w-40 truncate text-slate-400">{d.file_name}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
