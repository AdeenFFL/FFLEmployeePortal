"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CONTACT_METHODS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  TICKET_PRIORITIES,
} from "@/lib/it/tickets";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
} from "../../_components/ticket-ui";

type Option = { id: string; name: string };
type Category = Option & { parent_id: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${primaryButtonClass} disabled:opacity-60`}>
      {pending ? "Submitting…" : "Submit Ticket"}
    </button>
  );
}

// SCR-01 / BRD §5.3.1. Subcategory options follow the chosen category; attachments are
// checked here for a quick message and again in createItTicket() (the real check).
export function TicketForm({
  action,
  requestTypes,
  categories,
  sites,
  departments,
  defaultSiteId,
}: {
  action: (formData: FormData) => Promise<void>;
  requestTypes: (Option & { description: string | null })[];
  categories: Category[];
  sites: Option[];
  departments: Option[];
  defaultSiteId: string | null;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const topLevel = categories.filter((c) => !c.parent_id);
  const subcategories = categories.filter((c) => c.parent_id === categoryId);

  function checkFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > MAX_ATTACHMENTS) {
      setFileError(`Attach at most ${MAX_ATTACHMENTS} files.`);
      e.target.value = "";
    } else if (files.some((f) => f.size > MAX_ATTACHMENT_BYTES)) {
      setFileError("Each attachment must be 5 MB or smaller.");
      e.target.value = "";
    } else if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      setFileError("Attachments must be 8 MB or smaller in total.");
      e.target.value = "";
    } else {
      setFileError(null);
    }
  }

  return (
    <form
      action={action}
      className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="requestTypeId" className={labelClass}>
            Request type <span className="text-red-500">*</span>
          </label>
          <select id="requestTypeId" name="requestTypeId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {requestTypes.map((t) => (
              <option key={t.id} value={t.id} title={t.description ?? undefined}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className={labelClass}>
            Priority <span className="text-red-500">*</span>
          </label>
          <select id="priority" name="priority" required className={inputClass} defaultValue="Medium">
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="categoryId" className={labelClass}>
            Category
          </label>
          <select
            id="categoryId"
            name="categoryId"
            className={inputClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Not sure</option>
            {topLevel.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="subcategoryId" className={labelClass}>
            Subcategory
          </label>
          <select
            id="subcategoryId"
            name="subcategoryId"
            className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
            disabled={subcategories.length === 0}
            key={categoryId}
            defaultValue=""
          >
            <option value="">{subcategories.length === 0 ? "—" : "Select…"}</option>
            {subcategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <label htmlFor="subject" className={labelClass}>
            Subject <span className="text-red-500">*</span>
          </label>
          <input
            id="subject"
            name="subject"
            required
            maxLength={200}
            placeholder="e.g. Laptop won't connect to office Wi-Fi"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="description" className={labelClass}>
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={5}
            placeholder="What happened, when it started, and any error message you see."
            className={inputClass}
          />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="siteId" className={labelClass}>
            Location
          </label>
          <select id="siteId" name="siteId" className={inputClass} defaultValue={defaultSiteId ?? ""}>
            <option value="">—</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="departmentId" className={labelClass}>
            Department
          </label>
          <select id="departmentId" name="departmentId" className={inputClass} defaultValue="">
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="assetSystemName" className={labelClass}>
            Asset / system name <span className="font-normal text-slate-400">(if applicable)</span>
          </label>
          <input
            id="assetSystemName"
            name="assetSystemName"
            placeholder="e.g. HP ProBook 450, SAP, VPN"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="accessRequired" className={labelClass}>
            Access required <span className="font-normal text-slate-400">(if applicable)</span>
          </label>
          <input
            id="accessRequired"
            name="accessRequired"
            placeholder="e.g. Finance shared folder (read/write)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="preferredContactMethod" className={labelClass}>
            Preferred contact method
          </label>
          <select
            id="preferredContactMethod"
            name="preferredContactMethod"
            className={inputClass}
            defaultValue="Portal"
          >
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="managerApprovalRequired"
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Manager approval required
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <label htmlFor="attachments" className={labelClass}>
            Attachments{" "}
            <span className="font-normal text-slate-400">
              (optional, up to {MAX_ATTACHMENTS} files, 5 MB each, 8 MB total)
            </span>
          </label>
          <input
            id="attachments"
            name="attachments"
            type="file"
            multiple
            onChange={checkFiles}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          {fileError && <p className="mt-1 text-sm text-red-600">{fileError}</p>}
        </div>
        <div>
          <label htmlFor="remarks" className={labelClass}>
            Additional remarks
          </label>
          <textarea id="remarks" name="remarks" rows={2} className={inputClass} />
        </div>
      </section>

      <div className="flex justify-end border-t border-slate-100 pt-4">
        <SubmitButton />
      </div>
    </form>
  );
}
