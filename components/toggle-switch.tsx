export function ToggleSwitch({
  pressed,
  label,
  type = "submit",
  onClick,
}: {
  pressed: boolean;
  label?: string;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
        pressed ? "bg-blue-600" : "bg-slate-200"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          pressed ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
