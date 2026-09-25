import { useQuery } from "@tanstack/react-query";
import { Sparkles, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MatchScoreCompare } from "@/components/MatchScoreCompare";
import { LiveIndicator } from "@/components/LiveIndicator";
import { StreakIndicator } from "@/components/StreakIndicator";
import { TeamBadge } from "@/components/TeamBadge";
import { formatPoints } from "@/lib/leaderboard-ranking";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type UserPredRow = {
  match_id: string;
  kickoff_at: string;
  status: string;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  home_pred: number | null;
  away_pred: number | null;
  points: number | null;
  exact: boolean | null;
  is_wildcard: boolean | null;
};

export type RankingRowSummary = {
  prizeLabel?: string | null;
  hits?: string;
  exact?: number;
  streak?: number;
  wildcards?: number;
  specialPts?: number;
  withdrew?: boolean;
  winner?: {
    name: string;
    crestUrl?: string | null;
    shortName?: string | null;
  } | null;
  support?: {
    name: string;
    advances?: number | null;
    crestUrl?: string | null;
    shortName?: string | null;
  } | null;
  scorer?: {
    name: string;
    goals?: number | null;
    photoUrl?: string | null;
  } | null;
  defense?: {
    name: string;
    crestUrl?: string | null;
    shortName?: string | null;
  } | null;
};

function ScorerAvatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl?: string | null;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary grid place-items-center text-[9px] font-bold shrink-0 overflow-hidden">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

export function UserPredictionsSheet({
  open,
  onOpenChange,
  tournamentId,
  userId,
  displayName,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  userId: string | null;
  displayName: string;
  summary?: RankingRowSummary;
}) {
  const { t, formatMatchTime } = useT();
  const h = t.ranking.history;
  const r = t.ranking;

  const { data, isLoading } = useQuery({
    queryKey: ["user-predictions-history", tournamentId, userId],
    enabled: open && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_user_tournament_predictions", {
        _tournament_id: tournamentId,
        _user_id: userId!,
      });
      if (error) throw error;
      return (data ?? []) as UserPredRow[];
    },
  });

  const hasSpecials =
    !!summary &&
    (!!summary.winner ||
      !!summary.support ||
      !!summary.scorer ||
      !!summary.defense ||
      !!summary.prizeLabel ||
      (summary.streak ?? 0) > 0 ||
      (summary.wildcards ?? 0) > 0 ||
      (summary.specialPts ?? 0) > 0 ||
      !!summary.hits);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle>{h.userTitle}</SheetTitle>
          <SheetDescription>
            {displayName}: {h.userDesc}
          </SheetDescription>
        </SheetHeader>

        {hasSpecials && summary && (
          <div className="mt-4 rounded-xl border bg-muted/30 p-3 space-y-2.5 sm:hidden">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {h.summaryTitle}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {summary.hits && (
                <span>
                  {r.correctLabel}: <b className="text-foreground tabular">{summary.hits}</b>
                </span>
              )}
              {summary.exact != null && (
                <span>
                  {r.exactLabel}: <b className="text-foreground tabular">{summary.exact}</b>
                </span>
              )}
              {summary.prizeLabel && (
                <span className="text-primary font-bold tabular">{summary.prizeLabel}</span>
              )}
              {(summary.streak ?? 0) > 0 && <StreakIndicator current={summary.streak!} />}
              {(summary.wildcards ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 text-gold">
                  <Star className="w-3 h-3 fill-current" />
                  {summary.wildcards}
                </span>
              )}
              {(summary.specialPts ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 text-primary">
                  <Sparkles className="w-3 h-3" />+{formatPoints(summary.specialPts!)}
                </span>
              )}
            </div>
            <ul className="space-y-1.5 text-sm">
              {summary.winner && (
                <li className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{r.winnerLabel}</span>
                  <TeamBadge
                    name={summary.winner.name}
                    shortName={summary.winner.shortName}
                    crestUrl={summary.winner.crestUrl}
                    size="sm"
                  />
                  <span className="truncate font-medium">{summary.winner.name}</span>
                </li>
              )}
              {summary.support && (
                <li className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{r.supportLabel}</span>
                  <TeamBadge
                    name={summary.support.name}
                    shortName={summary.support.shortName}
                    crestUrl={summary.support.crestUrl}
                    size="sm"
                  />
                  <span className="truncate font-medium">
                    {summary.support.name}
                    {summary.support.advances != null ? ` (${summary.support.advances})` : ""}
                  </span>
                </li>
              )}
              {summary.scorer && (
                <li className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{r.topScorerLabel}</span>
                  <ScorerAvatar name={summary.scorer.name} photoUrl={summary.scorer.photoUrl} />
                  <span className="truncate font-medium">
                    {summary.scorer.name}
                    {summary.scorer.goals != null ? ` · ${summary.scorer.goals}` : ""}
                  </span>
                </li>
              )}
              {summary.defense && (
                <li className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{r.bestDefenseLabel}</span>
                  <TeamBadge
                    name={summary.defense.name}
                    shortName={summary.defense.shortName}
                    crestUrl={summary.defense.crestUrl}
                    size="sm"
                  />
                  <span className="truncate font-medium">{summary.defense.name}</span>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-4 space-y-2.5 pb-6">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{h.userEmpty}</p>
          ) : (
            data.map((row) => {
              const isLive = row.status === "live";
              const isFinished = row.status === "finished";
              const hasReal = row.home_score != null && row.away_score != null;
              return (
                <div
                  key={row.match_id}
                  className={cn(
                    "rounded-xl border bg-card p-3.5 shadow-card",
                    row.exact && (row.points ?? 0) > 0 && "border-success/40 bg-success/5",
                    !row.exact && (row.points ?? 0) > 0 && "border-primary/30 bg-primary/5",
                    hasReal && (row.points ?? 0) <= 0 && row.home_pred != null && "border-destructive/25",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-2">
                    <span className="tabular">{formatMatchTime(row.kickoff_at)}</span>
                    {isLive ? (
                      <LiveIndicator />
                    ) : isFinished ? (
                      <span className="uppercase tracking-wider font-semibold text-[10px]">
                        {t.matches.finished}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-w-0">
                    <p className="font-semibold truncate text-right text-sm min-w-0">
                      {row.home_team_name ?? "-"}
                    </p>
                    <span
                      className={cn(
                        "font-mono font-extrabold tabular text-base sm:text-lg px-2.5 py-1 rounded-md shrink-0",
                        isLive
                          ? "bg-destructive/10 text-destructive"
                          : hasReal
                            ? "bg-primary/10 text-primary"
                            : "bg-muted",
                      )}
                    >
                      {row.home_score ?? "–"} : {row.away_score ?? "–"}
                    </span>
                    <p className="font-semibold truncate text-sm min-w-0">
                      {row.away_team_name ?? "-"}
                    </p>
                  </div>

                  {hasReal ? (
                    <MatchScoreCompare
                      highlight="pick"
                      homeScore={row.home_score}
                      awayScore={row.away_score}
                      pick={{
                        homePred: row.home_pred,
                        awayPred: row.away_pred,
                        points: row.points,
                        exact: row.exact,
                        isWildcard: row.is_wildcard,
                      }}
                    />
                  ) : (
                    <p className="mt-2.5 pt-2.5 border-t text-center text-sm text-muted-foreground tabular">
                      {h.pick}:{" "}
                      <span className="font-mono font-bold text-foreground">
                        {row.home_pred ?? "–"} – {row.away_pred ?? "–"}
                      </span>
                      {row.is_wildcard ? (
                        <span className="inline-flex items-center gap-0.5 text-gold ml-1.5">
                          <Star className="w-3 h-3 fill-current" /> WC
                        </span>
                      ) : null}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
