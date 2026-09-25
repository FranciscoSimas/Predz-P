import { useState } from "react";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, { box: string; text: string; img: string }> = {
  sm: { box: "w-6 h-6", text: "text-[9px]", img: "w-4 h-4" },
  md: { box: "w-8 h-8", text: "text-[10px]", img: "w-6 h-6" },
  lg: { box: "w-12 h-12", text: "text-xs", img: "w-9 h-9" },
  xl: { box: "w-14 h-14", text: "text-sm", img: "w-11 h-11" },
};

function initials(name: string, shortName?: string | null) {
  if (shortName && shortName.length <= 4) return shortName.toUpperCase();
  return (
    name
      .replace(/\b(FC|CF|SC|AC|SL|SAD)\b/gi, "")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 3) || name.slice(0, 2).toUpperCase()
  );
}

export function TeamBadge({
  name,
  shortName,
  crestUrl,
  size = "md",
  className = "",
}: {
  name: string;
  shortName?: string | null;
  crestUrl?: string | null;
  size?: Size;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const s = SIZES[size];
  const showImg = crestUrl && !failed;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-secondary text-secondary-foreground shrink-0 overflow-hidden ${s.box} ${className}`}
      aria-label={name}
      title={name}
    >
      {showImg ? (
        <img
          src={crestUrl!}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className={`object-contain ${s.img}`}
        />
      ) : (
        <span className={`font-bold tabular ${s.text}`}>{initials(name, shortName)}</span>
      )}
    </span>
  );
}
