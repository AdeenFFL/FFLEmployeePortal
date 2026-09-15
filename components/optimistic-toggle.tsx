"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ToggleSwitch } from "@/components/toggle-switch";

// Wraps a toggle-shaped Server Action (setUserStatus, setOrgUnitStatus,
// togglePermissionInGroup, ...) with instant visual feedback. Flips immediately on click;
// useOptimistic automatically reverts to the real `pressed` value if `action` throws, since the
// underlying server state was never actually updated in that case — no manual rollback needed.
export function OptimisticToggle({
  pressed,
  label,
  action,
  statusLabels,
}: {
  pressed: boolean;
  label: string;
  action: () => Promise<void>;
  // Optional adjacent status text (e.g. "Active"/"Inactive") — driven by the same optimistic
  // value so it flips in lockstep with the switch instead of lagging behind until revalidation.
  statusLabels?: { on: string; off: string };
}) {
  const [optimisticPressed, setOptimisticPressed] = useOptimistic(pressed);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      setOptimisticPressed(!pressed);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <ToggleSwitch type="button" pressed={optimisticPressed} label={label} onClick={handleClick} />
      {statusLabels && (
        <span className="text-sm text-slate-500">
          {optimisticPressed ? statusLabels.on : statusLabels.off}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
