import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { teamCrestUrl } from "@/lib/team-crest";
import { cn } from "@/lib/utils";

export type MatchTeamInfo = {
  name: string;
  short_name?: string | null;
  crest_url?: string | null;
  crest_override_url?: string | null;
} | null;

/**
 * Prefer full club name; switch to short_name only when the full name would truncate.
 */
export function TeamNameLabel({
  name,
  shortName,
  align = "left",
  className,
}: {
  name: string;
  shortName?: string | null;
  align?: "left" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [useShort, setUseShort] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const full = (name || "").trim();
      const short = (shortName || "").trim();
      if (!full) {
        setUseShort(!!short);
        return;
      }
      if (!short || short === full) {
        setUseShort(false);
        return;
      }
      const prev = el.textContent;
      el.textContent = full;
      const overflows = el.scrollWidth > el.clientWidth + 1;
      el.textContent = prev;
      setUseShort(overflows);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, shortName]);

  const full = (name || "").trim();
  const short = (shortName || "").trim();
  const label = useShort && short ? short : full || short;

  return (
    <p
      ref={ref}
      title={full || short || undefined}
      className={cn(
        "font-medium truncate min-w-0 text-sm sm:text-base leading-tight",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {label}
    </p>
  );
}

/** Shared home | center | away strip used on Jogos and Prognósticos. */
export function MatchTeamsRow({
  home,
  away,
  center,
  className,
}: {
  home: MatchTeamInfo;
  away: MatchTeamInfo;
  center: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3 min-w-0",
        className,
      )}
    >
      <div className="flex items-center justify-end gap-1.5 sm:gap-2 min-w-0">
        <TeamNameLabel
          name={home?.name ?? ""}
          shortName={home?.short_name}
          align="right"
        />
        <TeamBadge
          name={home?.name ?? ""}
          shortName={home?.short_name}
          crestUrl={teamCrestUrl(home)}
          size="xl"
          className="shrink-0 !w-11 !h-11 sm:!w-14 sm:!h-14 [&_img]:!w-8 [&_img]:!h-8 sm:[&_img]:!w-11 sm:[&_img]:!h-11"
        />
      </div>
      <div className="shrink-0 flex items-center justify-center">{center}</div>
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <TeamBadge
          name={away?.name ?? ""}
          shortName={away?.short_name}
          crestUrl={teamCrestUrl(away)}
          size="xl"
          className="shrink-0 !w-11 !h-11 sm:!w-14 sm:!h-14 [&_img]:!w-8 [&_img]:!h-8 sm:[&_img]:!w-11 sm:[&_img]:!h-11"
        />
        <TeamNameLabel
          name={away?.name ?? ""}
          shortName={away?.short_name}
          align="left"
        />
      </div>
    </div>
  );
}

export function MatchScoreBoard({
  homeScore,
  awayScore,
  tone = "muted",
}: {
  homeScore: number | null | undefined;
  awayScore: number | null | undefined;
  tone?: "muted" | "live" | "finished";
}) {
  return (
    <span
      className={cn(
        "font-mono font-extrabold tabular text-base sm:text-lg px-2.5 py-1.5 rounded-md shrink-0 min-w-[4.5rem] text-center",
        tone === "live" && "bg-destructive/10 text-destructive",
        tone === "finished" && "bg-primary/10 text-primary",
        tone === "muted" && "bg-muted",
      )}
    >
      {homeScore ?? "–"} : {awayScore ?? "–"}
    </span>
  );
}
