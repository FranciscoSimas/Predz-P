import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Star, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPoints } from "@/lib/leaderboard-ranking";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type MatchPredRow = {
  user_id: string;
  display_name: string | null;
  home_pred: number | null;
  away_pred: number | null;
  points: number | null;
  exact: boolean | null;
  is_wildcard: boolean | null;
  withdrawn_at: string | null;
};

function PointsCell({ points, exact }: { points: number | null; exact: boolean | null }) {
  const { t } = useT();
  const pts = points ?? 0;
  if (pts <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive font-bold tabular text-sm">
        <XCircle className="w-3.5 h-3.5" />
        0 {t.common.points}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-bold tabular text-sm",
        exact ? "text-success" : "text-primary",
      )}
    >
      <CheckCircle2 className="w-3.5 h-3.5" />
      {formatPoints(pts)} {t.common.points}
      {exact ? ` · ${t.ranking.history.exact}` : ""}
    </span>
  );
}

export function MatchPredictionsSheet({
  open,
  onOpenChange,
  tournamentId,
  matchId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  matchId: string | null;
  title: string;
}) {
  const { t } = useT();
  const h = t.ranking.history;

  const { data, isLoading } = useQuery({
    queryKey: ["match-predictions-history", tournamentId, matchId],
    enabled: open && !!matchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_match_tournament_predictions", {
        _tournament_id: tournamentId,
        _match_id: matchId!,
      });
      if (error) throw error;
      return (data ?? []) as MatchPredRow[];
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{h.matchTitle}</SheetTitle>
          <SheetDescription>{title}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2 pb-6">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{h.matchEmpty}</p>
          ) : (
            data.map((row) => {
              const hasPick = row.home_pred != null && row.away_pred != null;
              return (
                <div
                  key={row.user_id}
                  className={cn(
                    "rounded-xl border p-3.5 flex items-center justify-between gap-3 shadow-card",
                    row.withdrawn_at && "border-destructive/40 bg-destructive/5",
                    !row.withdrawn_at && row.exact && (row.points ?? 0) > 0 && "border-success/40 bg-success/5",
                    !row.withdrawn_at && !row.exact && (row.points ?? 0) > 0 && "border-primary/30 bg-primary/5",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={cn(
                        "text-sm font-semibold truncate",
                        row.withdrawn_at && "text-destructive",
                      )}
                    >
                      {row.display_name ?? t.ranking.player}
                      {row.withdrawn_at && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground uppercase tracking-wider">
                          {t.ranking.withdrew}
                        </span>
                      )}
                    </p>
                    <p className="text-sm tabular">
                      <span className="text-muted-foreground font-medium">{h.pick}:</span>{" "}
                      {hasPick ? (
                        <span className="font-mono font-extrabold inline-flex items-center gap-1">
                          {row.home_pred} – {row.away_pred}
                          {row.is_wildcard ? (
                            <Star className="w-3.5 h-3.5 text-gold fill-current" />
                          ) : null}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground">{t.matches.compare.noPick}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {hasPick ? (
                      <PointsCell points={row.points} exact={row.exact} />
                    ) : (
                      <span className="text-xs text-muted-foreground font-semibold">
                        {t.matches.compare.noPoints}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Opens match history after kickoff, or when the match is live/finished (manual results). */
export function isMatchHistoryAvailable(kickoffAt: string, status?: string | null) {
  if (status === "live" || status === "finished") return true;
  return new Date(kickoffAt) <= new Date();
}

export function openMatchHistoryIfKickedOff(
  kickoffAt: string,
  open: () => void,
  lockedMsg: string,
  status?: string | null,
) {
  if (isMatchHistoryAvailable(kickoffAt, status)) {
    open();
  } else {
    toast.message(lockedMsg);
  }
}
