// Shared product picture: Raise Demand cards, the Product Master table and product pages.

export type Kind = "laptop" | "desktop" | "monitor" | "printer" | "network" | "phone" | "accessory" | "box";

// A picture for a product, guessed from its name / category (no image upload needed).
export function productKind(p: { name: string; category: string | null }): Kind {
  const t = `${p.name} ${p.category ?? ""}`.toLowerCase();
  if (/laptop|notebook|macbook|thinkpad/.test(t)) return "laptop";
  if (/desktop|\bpc\b|workstation|\bcpu\b/.test(t)) return "desktop";
  if (/monitor|screen|display|\blcd\b|\bled\b/.test(t)) return "monitor";
  if (/printer|scanner|toner|cartridge|\bink\b/.test(t)) return "printer";
  if (/router|switch|network|cable|wifi|access point|firewall/.test(t)) return "network";
  if (/phone|mobile|tablet|ipad/.test(t)) return "phone";
  if (/mouse|keyboard|headset|webcam|charger|adapter|\busb\b|\bhdd\b|\bssd\b|\bram\b/.test(t)) return "accessory";
  return "box";
}

export function ProductIcon({ kind, className = "h-6 w-6" }: { kind: Kind; className?: string }) {
  const paths: Record<Kind, string> = {
    laptop: "M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5V6.5ZM3 17h18l-1 2H4l-1-2Z",
    desktop: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-9ZM9 20h6M12 16v4",
    monitor: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-10ZM8 20h8",
    printer: "M7 9V4h10v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18M7 14h10v6H7v-6Z",
    network: "M12 4v5M5 20v-4h14v4M12 9a2 2 0 1 0 0 .01M5 20a1 1 0 1 0 0 .01M19 20a1 1 0 1 0 0 .01M12 11v5",
    phone: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM11 18h2",
    accessory: "M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5ZM12 3v6",
    box: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9",
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={paths[kind]} />
    </svg>
  );
}
