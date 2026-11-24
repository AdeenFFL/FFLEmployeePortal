import { Mrs_Saint_Delafield } from "next/font/google";

// A clearance signature: the signer's name in a handwriting font, in navy "pen" ink. next/font
// bundles the font with the app at build time, so the browser never loads it from Google.
const signatureFont = Mrs_Saint_Delafield({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export function SignatureName({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={`${signatureFont.className} text-[#1e3a8a] ${className}`}>
      {name}
    </span>
  );
}
