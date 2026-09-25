import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isMatchDisplayLive } from "@/components/MatchScoreCompare";
import { useT } from "@/lib/i18n";

export type MatchLike = {
  id?: string;
  round_or_matchday: number | null;
  kickoff_at: string;
  status: string;
  is_postponed?: boolean | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute a sensible default matchday:
 * 1. Highest round that has any live match (incl. optimistic live past kickoff).
 * 2. Otherwise, the round of the nearest upcoming non-postponed kickoff.
 * 3. Otherwise, the last round (season finished).
 *
 * Postponed fixtures are ignored for “current” (they surface as catch-ups on
 * the current round view via matchesForRoundView).
 */
export function pickDefaultRound(matches: MatchLike[], rounds: number[]): number | null {
  if (rounds.length === 0) return null;
  const now = Date.now();

  let liveRound: number | null = null;
  for (const m of matches) {
    if (m.round_or_matchday == null || !rounds.includes(m.round_or_matchday)) continue;
    if (!isMatchDisplayLive(m.kickoff_at, m.status, !!m.is_postponed)) continue;
    if (liveRound == null || m.round_or_matchday > liveRound) {
      liveRound = m.round_or_matchday;
    }
  }
  if (liveRound != null) return liveRound;

  let nearest: MatchLike | null = null;
  let nearestTs = Infinity;
  for (const m of matches) {
    if (m.is_postponed) continue;
    if (m.status !== "scheduled" && m.status !== "live") continue;
    const ts = new Date(m.kickoff_at).getTime();
    if (Number.isNaN(ts) || ts < now) continue;
    if (ts < nearestTs) {
      nearestTs = ts;
      nearest = m;
    }
  }
  if (nearest?.round_or_matchday != null && rounds.includes(nearest.round_or_matchday)) {
    return nearest.round_or_matchday;
  }
  return rounds[rounds.length - 1];
}

const ROUND_STORAGE_PREFIX = "predz:matchday:v2:";

export function readStoredRound(scopeKey: string): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ROUND_STORAGE_PREFIX + scopeKey);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeStoredRound(scopeKey: string, round: number) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(ROUND_STORAGE_PREFIX + scopeKey, String(round));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Home-round matches plus catch-up postponed fixtures when viewing the current round. */
export function matchesForRoundView<T extends MatchLike>(
  matches: T[],
  round: number,
  currentRound: number | null,
): T[] {
  const home = matches.filter((m) => m.round_or_matchday === round);
  if (currentRound == null || round !== currentRound) {
    return [...home].sort(
      (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
    );
  }

  let windowStart: number;
  let windowEnd: number;
  if (home.length > 0) {
    const kicks = home.map((m) => new Date(m.kickoff_at).getTime());
    windowStart = Math.min(...kicks) - DAY_MS;
    windowEnd = Math.max(...kicks) + 2 * DAY_MS;
  } else {
    const now = Date.now();
    windowStart = now - DAY_MS;
    windowEnd = now + 7 * DAY_MS;
  }

  const seen = new Set(home.map((m) => m.id ?? `${m.round_or_matchday}-${m.kickoff_at}`));
  const catchUps = matches.filter((m) => {
    if (!m.is_postponed) return false;
    if (m.status !== "scheduled" && m.status !== "live") return false;
    if (m.round_or_matchday == null || m.round_or_matchday === round) return false;
    const ts = new Date(m.kickoff_at).getTime();
    if (Number.isNaN(ts) || ts < windowStart || ts > windowEnd) return false;
    const key = m.id ?? `${m.round_or_matchday}-${m.kickoff_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...home, ...catchUps].sort(
    (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
  );
}

export function MatchdayNavigator({
  round,
  rounds,
  onChange,
  currentRound = null,
  roundLabels,
  className = "",
}: {
  round: number | null;
  rounds: number[];
  onChange: (next: number) => void;
  /** Sensible “current” matchday (live / next upcoming). Enables the jump button. */
  currentRound?: number | null;
  /** Optional per-round display labels (e.g. Oitavos instead of number). */
  roundLabels?: Record<number, string>;
  className?: string;
}) {
  const { t } = useT();
  const n = t.navigator;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing && round != null) setDraft(String(round));
  }, [round, editing]);

  if (!rounds.length || round == null) return null;
  const idx = rounds.indexOf(round);
  const total = rounds.length;
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < total - 1;
  const lastRound = rounds[total - 1];
  const canJumpCurrent =
    currentRound != null && rounds.includes(currentRound) && currentRound !== round;
  const titleLabel = roundLabels?.[round];

  function commitDraft() {
    setEditing(false);
    const parsed = Number.parseInt(draft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(round));
      return;
    }
    if (rounds.includes(parsed)) {
      if (parsed !== round) onChange(parsed);
      setDraft(String(parsed));
      return;
    }
    const nearest = rounds.reduce((best, r) =>
      Math.abs(r - parsed) < Math.abs(best - parsed) ? r : best,
    );
    if (nearest !== round) onChange(nearest);
    setDraft(String(nearest));
  }

  return (
    <div className={`rounded-xl border bg-card px-2 py-2 shadow-card space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-10 px-2 sm:px-3"
          disabled={!canPrev}
          onClick={() => canPrev && onChange(rounds[idx - 1])}
          aria-label={n.prevAria}
        >
          <ChevronLeft className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">{n.previous}</span>
        </Button>
        <div className="text-center min-w-0 px-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {titleLabel ? titleLabel : n.matchday}
          </p>
          <div className="flex items-baseline justify-center gap-1 font-extrabold tabular text-base sm:text-lg leading-tight">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={editing ? draft : String(round)}
              aria-label={n.jumpAria}
              title={n.jumpHint}
              onFocus={(e) => {
                setEditing(true);
                setDraft(String(round));
                requestAnimationFrame(() => e.target.select());
              }}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Escape") {
                  setDraft(String(round));
                  setEditing(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-10 sm:w-12 bg-transparent text-center font-extrabold tabular outline-none rounded-md border border-transparent hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/30 cursor-text"
            />
            <span className="text-muted-foreground font-medium">
              {n.of} {lastRound}
            </span>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5 hidden sm:block">{n.jumpHint}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 px-2 sm:px-3"
          disabled={!canNext}
          onClick={() => canNext && onChange(rounds[idx + 1])}
          aria-label={n.nextAria}
        >
          <span className="hidden sm:inline">{n.next}</span>
          <ChevronRight className="w-4 h-4 sm:ml-1" />
        </Button>
      </div>
      {currentRound != null && (
        <div className="flex justify-center px-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs font-semibold"
            disabled={!canJumpCurrent}
            onClick={() => canJumpCurrent && onChange(currentRound)}
            aria-label={n.currentAria}
          >
            {n.current}
          </Button>
        </div>
      )}
    </div>
  );
}
