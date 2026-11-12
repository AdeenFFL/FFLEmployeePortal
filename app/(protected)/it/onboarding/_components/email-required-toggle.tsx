"use client";

// "Company email required" checkbox for the New onboarding form. When it's unticked the portal
// account is created on the personal email, so that field becomes required (the browser stops the
// form, same rule createLifecycleRequest checks on the server).
export function EmailRequiredToggle() {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name="emailRequired"
        defaultChecked
        className="h-4 w-4"
        onChange={(e) => {
          const personalEmail = e.currentTarget.form?.elements.namedItem("personalEmail");
          if (personalEmail instanceof HTMLInputElement) personalEmail.required = !e.currentTarget.checked;
        }}
      />
      Company email required
    </label>
  );
}
