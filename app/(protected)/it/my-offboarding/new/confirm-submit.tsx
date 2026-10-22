"use client";

import { primaryButtonClass } from "../../_components/ticket-ui";

// ConfirmSubmitButton (components/confirm-submit-button.tsx) is a fixed-size icon button built
// for hardDeleteUser's icon-only destructive-action UI — wrong shape for a full-width labeled
// primary button here. Same window.confirm() idea, right shape: this is an irreversible action
// that notifies HR and IT, so it gets a confirm step like the portal's other severe actions.
export function ConfirmSubmit() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm("Submit this offboarding request? IT and HR will be notified.")) {
          e.preventDefault();
        }
      }}
      className={primaryButtonClass}
    >
      Submit request
    </button>
  );
}
