/**
 * Sofascore widget embed (iframe only).
 * Allowed for Predz per partnerships email (2026-07): keep widget unmodified
 * and Sofascore branding/attribution visible. Never use for scoring/data sync.
 */
export function SofascoreEmbed({
  src,
  title = "Sofascore",
  className = "",
  minHeight,
}: {
  /** Full iframe src from Sofascore widget generator */
  src: string;
  title?: string;
  className?: string;
  minHeight?: number;
}) {
  if (!src || !src.includes("sofascore")) {
    return null;
  }

  // Standings widgets need ~full table height; the generator uses ~1043px.
  const isStandings = /\/standings/i.test(src);
  const height = minHeight ?? (isStandings ? 1100 : 420);

  return (
    <div className={`w-full min-w-0 overflow-x-hidden rounded-xl border bg-card ${className}`}>
      <iframe
        src={src}
        title={title}
        className="w-full border-0"
        style={{ height, minHeight: height }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        scrolling="no"
      />
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">
        Data and branding by Sofascore. Widget must remain unmodified.
      </p>
    </div>
  );
}
