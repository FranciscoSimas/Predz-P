import { useState } from "react";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { box: string; text: string; img: string }> = {
  sm: { box: "w-6 h-6", text: "text-[9px]", img: "w-5 h-5" },
  md: { box: "w-9 h-9", text: "text-[10px]", img: "w-7 h-7" },
  lg: { box: "w-12 h-12", text: "text-xs", img: "w-10 h-10" },
};

function initials(name: string) {
  return (
    name
      .replace(/\b(FC|CF|SC|AC|SL|SAD|Liga|League|Série|Serie|A)\b/gi, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || name.slice(0, 2).toUpperCase()
  );
}

export function CompetitionBadge({
  name,
  logoUrl,
  size = "md",
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  size?: Size;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const s = SIZES[size];
  const showImg = logoUrl && !failed;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0 overflow-hidden ${s.box} ${className}`}
      aria-label={name}
      title={name}
    >
      {showImg ? (
        <img
          src={logoUrl!}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className={`object-contain ${s.img}`}
        />
      ) : (
        <span className={`font-bold tabular ${s.text}`}>{initials(name)}</span>
      )}
    </span>
  );
}

/**
 * Deprecated: prefer `useT().formatLabel(format)` for a translated label.
 * Kept as a fallback for non-React contexts; returns the raw key.
 */
export function formatLabel(format: string | null | undefined) {
  if (!format) return "";
  return format;
}
