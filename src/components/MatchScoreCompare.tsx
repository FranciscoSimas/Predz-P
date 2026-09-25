import type { ReactNode } from "react";
import { CheckCircle2, XCircle, Star, Flame } from "lucide-react";
import { formatPoints } from "@/lib/leaderboard-ranking";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type PickCompare = {
  homePred: number | null | undefined;
  awayPred: number | null | undefined;
  points?: number | null;
  exact?: boolean | null;
  isWildcard?: boolean | null;
  pointsAdvancement?: number | null;
  points90?: number | null;
  pointsEt?: number | null;
  pointsPen?: number | null;
  pointsBeforeMultiplier?: number | null;
};

/** True when picks must be locked (kickoff passed, live, or finished — incl. manual results). */
export function isMatchPickLocked(
  kickoffAt: string,
  status?: string | null,
  withdrawn = false,
  isPostponed = false,
) {
  if (withdrawn) return true;
  if (status === "live" || status === "finished") return true;
  const kick = new Date(kickoffAt).getTime();
  const now = Date.now();
  if (Number.isNaN(kick)) return false;
  // Stale postponed date (no reschedule yet) must not lock predictions.
  if (isPostponed && status === "scheduled" && kick < now - 24 * 60 * 60 * 1000) {
    return false;
  }
  return kick <= now;
}

/**
 * Visual "live" for the user: real live status, or scheduled past kickoff
 * within a short window (optimistic — DB may still say scheduled until sync).
 * Never for postponed, finished, or stale scheduled kickoffs (e.g. old adiados).
 */
const OPTIMISTIC_LIVE_AFTER_KICKOFF_MS = 3 * 60 * 60 * 1000; // 3h

export function isMatchDisplayLive(
  kickoffAt: string,
  status?: string | null,
  isPostponed = false,
) {
  if (isPostponed) return false;
  if (status === "finished") return false;
  if (status === "live") return true;
  if (status != null && status !== "scheduled") return false;
  const kick = new Date(kickoffAt).getTime();
  if (Number.isNaN(kick)) return false;
  const now = Date.now();
  if (kick > now) return false;
  return now - kick < OPTIMISTIC_LIVE_AFTER_KICKOFF_MS;
}

function PointsPill({
  hasPick,
  pts,
  exact,
  streakBonus,
  isWildcard,
  breakdown,
}: {
  hasPick: boolean;
  pts: number | null;
  exact: boolean;
  streakBonus?: number | null;
  isWildcard?: boolean;
  breakdown?: string | null;
}) {
  const { t } = useT();
  const m = t.matches.compare;

  if (!hasPick) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-bold tabular">
        {m.noPoints}
      </span>
    );
  }
  if (pts == null) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-bold tabular">
        {m.pending}
      </span>
    );
  }
  if (pts <= 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive text-xs font-bold tabular">
        <XCircle className="w-3.5 h-3.5" />
        0 {t.common.points}
      </span>
    );
  }
  const ws = streakBonus != null && streakBonus > 0 ? streakBonus : 0;
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold tabular",
          exact ? "bg-success/15 text-success" : "bg-primary/10 text-primary",
        )}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        {formatPoints(pts)} {t.common.points}
        {exact ? ` · ${m.exact}` : ""}
        {isWildcard && <Star className="w-3.5 h-3.5 text-gold fill-current" aria-label="Wildcard" />}
      </span>
      {breakdown && (
        <span className="text-[10px] text-muted-foreground font-medium tabular">{breakdown}</span>
      )}
      {ws > 0 && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 text-xs font-bold tabular">
          <Flame className="w-3.5 h-3.5" />
          +{formatPoints(ws)} {m.wsBonus}
        </span>
      )}
    </span>
  );
}

/**
 * Footer under a finished match.
 *
 * Card-level order (center already shows the other score):
 * - Jogos: center = Real → footer highlight = pick (`highlight="pick"`)
 * - Prognósticos: center = pick inputs → footer highlight = real (`highlight="real"`)
 */
export function MatchScoreCompare({
  homeScore,
  awayScore,
  pick,
  className,
  highlight = "real",
  streakBonus,
}: {
  homeScore: number | null | undefined;
  awayScore: number | null | undefined;
  pick: PickCompare | null | undefined;
  className?: string;
  /** Which score line to emphasize in the footer (the other is already in the card center). */
  highlight?: "real" | "pick";
  streakBonus?: number | null;
}) {
  const { t } = useT();
  const m = t.matches.compare;
  const predI18n = t.predictions;
  const hasReal = homeScore != null && awayScore != null;
  if (!hasReal) return null;

  const hasPick = pick?.homePred != null && pick?.awayPred != null;
  const pts = pick?.points ?? null;
  const exact = !!pick?.exact;
  const wc = !!pick?.isWildcard;

  const breakdownParts: string[] = [];
  if ((pick?.pointsAdvancement ?? 0) > 0) {
    breakdownParts.push(`${predI18n.advancePts} +${formatPoints(pick!.pointsAdvancement!)}`);
  }
  if ((pick?.points90 ?? 0) > 0) {
    breakdownParts.push(`${predI18n.pts90} +${formatPoints(pick!.points90!)}`);
  }
  if ((pick?.pointsEt ?? 0) > 0) {
    breakdownParts.push(`${predI18n.ptsEt} +${formatPoints(pick!.pointsEt!)}`);
  }
  if ((pick?.pointsPen ?? 0) > 0) {
    breakdownParts.push(`${predI18n.ptsPen} +${formatPoints(pick!.pointsPen!)}`);
  }
  if (
    wc &&
    pick?.pointsBeforeMultiplier != null &&
    pick.points != null &&
    pick.points !== pick.pointsBeforeMultiplier
  ) {
    const mult = pick.points / Math.max(Number(pick.pointsBeforeMultiplier), 0.1);
    breakdownParts.push(`×${formatPoints(mult)}`);
  }
  const breakdown = breakdownParts.length > 1 ? breakdownParts.join(" · ") : null;

  const label = highlight === "pick" ? m.pick : m.real;
  let home: number | string = "–";
  let away: number | string = "–";
  let emptyHint: ReactNode = null;

  if (highlight === "real") {
    home = homeScore!;
    away = awayScore!;
  } else if (hasPick) {
    home = pick!.homePred!;
    away = pick!.awayPred!;
  } else {
    emptyHint = <span className="text-xs italic text-muted-foreground">{m.noPick}</span>;
  }

  return (
    <div
      className={cn(
        "mt-2.5 pt-2.5 border-t flex flex-col items-center justify-center gap-1.5 text-center",
        className,
      )}
    >
      <p className="font-mono text-xl sm:text-2xl font-extrabold tabular tracking-tight leading-none inline-flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <span>
          {home} – {away}
        </span>
        {highlight === "pick" && hasPick && wc && (
          <Star className="w-3.5 h-3.5 text-gold fill-current" aria-label="Wildcard" />
        )}
        {emptyHint}
      </p>
      <PointsPill
        hasPick={hasPick}
        pts={pts}
        exact={exact}
        streakBonus={streakBonus}
        isWildcard={highlight === "real" && wc}
        breakdown={breakdown}
      />
    </div>
  );
}
