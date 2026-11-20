"use client";

import { useState } from "react";
import type { ItStockMovementType } from "@/types/database";
import { inputClass, labelClass } from "../../_components/ticket-ui";
import { PersonPicker } from "../_components/person-picker";

const KINDS: { type: ItStockMovementType; label: string; hint: string }[] = [
  { type: "Received", label: "Stock in", hint: "Bought or returned items added to the store" },
  { type: "Issued", label: "Issue", hint: "Handed out to an employee or used up" },
  { type: "Adjustment", label: "Adjust", hint: "Correct a count — damaged, expired, miscounted" },
  { type: "Opening", label: "Opening balance", hint: "What is already on the shelf when you start" },
];

// Fields for the Record movement drawer. Only the inputs that matter for the chosen kind are
// shown: who it went to for an issue, up / down for an adjustment.
export function MovementFields({
  products,
  sites,
  defaultType,
  defaultProduct,
  defaultSite,
  onHand,
}: {
  products: { id: string; name: string; unit: string }[];
  sites: { id: string; name: string }[];
  defaultType: ItStockMovementType;
  defaultProduct: string;
  defaultSite: string;
  // "productId:siteId" → on hand, to show the current balance next to the quantity.
  onHand: Record<string, number>;
}) {
  const [type, setType] = useState<ItStockMovementType>(defaultType);
  const [productId, setProductId] = useState(defaultProduct);
  const [siteId, setSiteId] = useState(defaultSite);
  const balance = productId && siteId ? (onHand[`${productId}:${siteId}`] ?? 0) : null;
  const unit = products.find((p) => p.id === productId)?.unit ?? "";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <fieldset>
        <legend className={labelClass}>What happened?</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <label
              key={k.type}
              className="flex cursor-pointer flex-col rounded-xl border border-slate-200 px-3 py-2.5 hover:border-slate-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/50"
            >
              <input
                type="radio"
                name="type"
                value={k.type}
                checked={type === k.type}
                onChange={() => setType(k.type)}
                className="sr-only"
              />
              <span className="text-sm font-medium text-slate-900">{k.label}</span>
              <span className="text-xs text-slate-500">{k.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className={labelClass}>Product</span>
        <select
          name="productId"
          required
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Choose a consumable…
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>Site</span>
        <select name="siteId" required value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Quantity</span>
          <input name="quantity" type="number" min={1} step={1} required className={`${inputClass} tabular-nums`} />
          {balance !== null && (
            <span className="mt-1 block text-xs text-slate-500">
              {balance} {unit} in stock now
            </span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>Date</span>
          <input name="movementDate" type="date" max={today} defaultValue={today} className={inputClass} />
        </label>
      </div>

      {type === "Adjustment" && (
        <fieldset>
          <legend className={labelClass}>Direction</legend>
          <div className="flex gap-2">
            {[
              ["up", "Add (+)"],
              ["down", "Remove (−)"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-slate-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/50"
              >
                <input type="radio" name="direction" value={value} defaultChecked={value === "down"} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {type === "Issued" && (
        <div>
          <span className={labelClass}>
            Issued to <span className="font-normal text-slate-400">(or explain below)</span>
          </span>
          <PersonPicker name="personId" />
        </div>
      )}

      <label className="block">
        <span className={labelClass}>
          {type === "Adjustment" ? "Reason" : "Note"}{" "}
          {type !== "Adjustment" && <span className="font-normal text-slate-400">(optional)</span>}
        </span>
        <input
          name="reason"
          required={type === "Adjustment"}
          placeholder={
            type === "Adjustment"
              ? "e.g. Count on 5 Nov was 3 lower"
              : type === "Issued"
                ? "e.g. Used for the printer in Accounts"
                : "e.g. Bought locally, cash"
          }
          className={inputClass}
        />
      </label>
    </>
  );
}
