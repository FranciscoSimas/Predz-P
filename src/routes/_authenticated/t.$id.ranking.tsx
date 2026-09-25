import { useMemo, useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trophy, HelpCircle, Star, Sparkles, Scale } from "lucide-react";
import { StreakIndicator } from "@/components/StreakIndicator";
import { PrizesCard, getPlacePrize, type PrizesCardData } from "@/components/PrizesCard";
import { UserPredictionsSheet, type RankingRowSummary } from "@/components/UserPredictionsSheet";
import { TeamBadge } from "@/components/TeamBadge";
import {
  formatPoints,
  rankOptionsFromSettings,
  withCompetitionRanks,
} from "@/lib/leaderboard-ranking";
import { teamCrestUrl } from "@/lib/team-crest";
import { useT, fmt as interp } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$id/ranking")({
  component: RankingPage,
});

type LB = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  total_points: number;
  correct_count: number;
  exact_count: number;
  predictions_made: number | null;
  special_bets_points: number | null;
  streak_bonus_points: number | null;
  current_streak: number | null;
  best_streak: number | null;
  wildcards_used: number | null;
  withdrawn_at: string | null;
  winner_team_id: string | null;
  winner_team_name: string | null;
  support_team_id: string | null;
  support_team_name: string | null;
  support_advances: number | null;
  top_scorer_name: string | null;
  top_scorer_photo_url: string | null;
  top_scorer_goals: number | null;
  best_defense_team_id: string | null;
  best_defense_team_name: string | null;
};

type Ranked = LB & { rank: number };

type SpecialFlags = {
  special_bets_enabled: boolean;
  special_bet_winner_enabled: boolean;
  special_bet_support_team_enabled: boolean;
  special_bet_top_scorer_enabled: boolean;
  special_bet_best_defense_enabled: boolean;
  top_scorer_mode: string | null;
};

function initials(name: string | null | undefined, fallback: string) {
  return (name ?? fallback)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function PlayerAvatar({
  name,
  avatarUrl,
  fallback,
  withdrew,
  className,
}: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  fallback: string;
  withdrew?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = !!avatarUrl && !broken;
  return (
    <span
      className={cn(
        "rounded-full grid place-items-center font-bold shrink-0 overflow-hidden",
        withdrew ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary",
        className,
      )}
    >
      {showImg ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name, fallback)
      )}
    </span>
  );
}

function hitsLabel(correct: number, made: number, fmt: string) {
  if (made <= 0) return "-";
  const pct = Math.round((correct / made) * 100);
  return interp(fmt, { c: correct, t: made, p: pct });
}

function RankingPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/ranking" });
  const { t, formatMoney } = useT();
  const r = t.ranking;
  const [historyUser, setHistoryUser] = useState<{
    id: string;
    name: string;
    summary?: RankingRowSummary;
  } | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: flags } = useQuery({
    queryKey: ["ranking-special-flags", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select(
          "special_bets_enabled, special_bet_winner_enabled, special_bet_support_team_enabled, special_bet_top_scorer_enabled, special_bet_best_defense_enabled, top_scorer_mode, official_top_scorer, official_top_scorer_goals",
        )
        .eq("tournament_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as (SpecialFlags & {
        official_top_scorer: string | null;
        official_top_scorer_goals: number | null;
      }) | null;
    },
  });

  const { data: teamById } = useQuery({
    queryKey: ["ranking-team-crests", id],
    queryFn: async () => {
      const { data: tRow, error: tErr } = await supabase
        .from("tournaments")
        .select("competition_id")
        .eq("id", id)
        .single();
      if (tErr) throw tErr;
      const { data, error } = await supabase
        .from("competition_teams")
        .select("id, name, short_name, crest_url, crest_override_url")
        .eq("competition_id", tRow.competition_id);
      if (error) throw error;
      const map = new Map<
        string,
        { name: string; short_name: string | null; crest_url: string | null; crest_override_url: string | null }
      >();
      for (const row of data ?? []) {
        map.set(row.id, row as never);
      }
      return map;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", id],
    queryFn: async () => {
      const [lbRes, setRes] = await Promise.all([
        supabase.rpc("get_tournament_leaderboard", { _tournament_id: id }),
        supabase
          .from("tournament_settings")
          .select(
            "special_bets_enabled, special_bet_support_team_enabled, special_bet_top_scorer_enabled, top_scorer_mode",
          )
          .eq("tournament_id", id)
          .maybeSingle(),
      ]);
      if (lbRes.error) throw lbRes.error;
      if (setRes.error) throw setRes.error;
      return withCompetitionRanks(
        (lbRes.data ?? []) as unknown as LB[],
        rankOptionsFromSettings(setRes.data),
      );
    },
  });

  const { data: prizes } = useQuery({
    queryKey: ["prizes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select(
          "prizes_enabled, prize_entry_amount, prize_entry_currency, prize_pct_first, prize_pct_second, prize_pct_third, prize_custom",
        )
        .eq("tournament_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PrizesCardData | null;
    },
  });

  const memberCount = data?.length ?? 1;
  const podium = useMemo(() => (data ?? []).filter((row) => row.rank <= 3).slice(0, 3), [data]);
  const showPodium = podium.length >= 3 && podium.every((p, i) => p.rank === i + 1);
  const showSpecial = !!flags?.special_bets_enabled;
  const showPrizeCol = !!prizes?.prizes_enabled;
  const rankOpts = rankOptionsFromSettings(flags);
  const wideTable = showSpecial || showPrizeCol;

  function prizeForRank(rank: number) {
    if (rank < 1 || rank > 3) return null;
    const place = rank as 1 | 2 | 3;
    const prize = getPlacePrize(prizes, memberCount, place);
    if (!prize) return null;
    return formatMoney(prize.amount, prize.label);
  }

  function openHistory(row: Ranked) {
    const made = row.predictions_made ?? 0;
    setHistoryUser({
      id: row.user_id,
      name: row.display_name ?? r.player,
      summary: {
        prizeLabel: prizeForRank(row.rank),
        hits: hitsLabel(row.correct_count, made, r.hitsFmt),
        exact: row.exact_count,
        streak: row.current_streak ?? 0,
        wildcards: row.wildcards_used ?? 0,
        specialPts: row.special_bets_points ?? 0,
        withdrew: !!row.withdrawn_at,
        winner:
          showSpecial && flags?.special_bet_winner_enabled && row.winner_team_id
            ? {
                name: row.winner_team_name ?? teamById?.get(row.winner_team_id)?.short_name ?? "-",
                crestUrl: teamCrestUrl(teamById?.get(row.winner_team_id)),
                shortName: teamById?.get(row.winner_team_id)?.short_name ?? null,
              }
            : null,
        support:
          showSpecial && flags?.special_bet_support_team_enabled && row.support_team_id
            ? {
                name: row.support_team_name ?? "-",
                advances: row.support_advances,
                crestUrl: teamCrestUrl(teamById?.get(row.support_team_id)),
                shortName: teamById?.get(row.support_team_id)?.short_name ?? null,
              }
            : null,
        scorer:
          showSpecial && flags?.special_bet_top_scorer_enabled && row.top_scorer_name
            ? {
                name: row.top_scorer_name,
                goals: row.top_scorer_goals,
                photoUrl: row.top_scorer_photo_url,
              }
            : null,
        defense:
          showSpecial && flags?.special_bet_best_defense_enabled && row.best_defense_team_id
            ? {
                name: row.best_defense_team_name ?? "-",
                crestUrl: teamCrestUrl(teamById?.get(row.best_defense_team_id)),
                shortName: teamById?.get(row.best_defense_team_id)?.short_name ?? null,
              }
            : null,
      },
    });
  }

  return (
    <div className="space-y-4 sm:space-y-5 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-xl sm:text-2xl font-display tracking-wide truncate">{r.title}</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <TiebreakDialog
            showSupport={!!rankOpts.useSupportAdvances}
            showScorerGoals={!!rankOpts.useTopScorerGoals}
          />
          <PointsDialog tournamentId={id} />
        </div>
      </div>

      <PrizesCard data={prizes} memberCount={memberCount} compact />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<Trophy className="w-7 h-7" />}
          title={r.emptyTitle}
          description={r.emptyDesc}
        />
      ) : (
        <>
          {showPodium && (
            <div className="hidden sm:block">
              <PodiumCards
                rows={podium}
                playerFallback={r.player}
                prizeForRank={prizeForRank}
                onOpenHistory={openHistory}
              />
            </div>
          )}

          <Card className="p-0 overflow-hidden shadow-card min-w-0">
            <div className="w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
              <table
                className={cn(
                  "w-full text-[11px] sm:text-sm border-collapse",
                  wideTable && "min-w-[22rem] sm:min-w-[36rem]",
                )}
              >
                <thead className="bg-muted/50 text-[9px] sm:text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-20 bg-muted text-center font-semibold px-0.5 sm:px-3 py-1.5 sm:py-2.5 w-8 min-w-[2rem] sm:w-10">
                      {r.colRank}
                    </th>
                    <th className="sticky left-8 sm:left-10 z-20 bg-muted text-left font-semibold px-1 sm:px-3 py-1.5 sm:py-2.5 w-[5.5rem] sm:min-w-[8rem] shadow-[4px_0_6px_-4px_rgba(0,0,0,0.12)]">
                      {r.player}
                    </th>
                    {showPrizeCol && (
                      <th className="hidden sm:table-cell text-left font-semibold px-2 sm:px-3 py-2.5 whitespace-nowrap">
                        {r.colPrize}
                      </th>
                    )}
                    <th className="text-center font-semibold px-1 sm:px-2 py-1.5 sm:py-2.5 w-7 sm:w-auto whitespace-nowrap">
                      <span className="sm:hidden">{r.correctLabel}</span>
                      <span className="hidden sm:inline">{r.colHits}</span>
                    </th>
                    <th className="text-center font-semibold px-1 sm:px-2 py-1.5 sm:py-2.5 w-7 sm:w-auto whitespace-nowrap">
                      <span className="sm:hidden">{r.exactLabel}</span>
                      <span className="hidden sm:inline">{r.colExact}</span>
                    </th>
                    {showSpecial && flags?.special_bet_winner_enabled && (
                      <th className="text-center sm:text-left font-semibold px-1 sm:px-2 py-1.5 sm:py-2.5 w-8 sm:w-auto whitespace-nowrap">
                        {r.colWinner}
                      </th>
                    )}
                    {showSpecial && flags?.special_bet_support_team_enabled && (
                      <th className="hidden sm:table-cell text-left font-semibold px-2 py-2.5 whitespace-nowrap">
                        {r.colSupport}
                      </th>
                    )}
                    {showSpecial && flags?.special_bet_top_scorer_enabled && (
                      <th className="text-center sm:text-left font-semibold px-1 sm:px-2 py-1.5 sm:py-2.5 w-10 sm:w-auto whitespace-nowrap">
                        <span className="sm:hidden">{r.colScorer}</span>
                        <span className="hidden sm:inline">{r.colScorer}</span>
                      </th>
                    )}
                    {showSpecial && flags?.special_bet_top_scorer_enabled && (
                      <th className="hidden sm:table-cell text-center font-semibold px-2 py-2.5 whitespace-nowrap">
                        {r.colGoals}
                      </th>
                    )}
                    {showSpecial && flags?.special_bet_best_defense_enabled && (
                      <th className="hidden sm:table-cell text-left font-semibold px-2 py-2.5 whitespace-nowrap">
                        {r.colDefense}
                      </th>
                    )}
                    <th className="text-right font-semibold px-1 sm:px-3 py-1.5 sm:py-2.5 text-primary whitespace-nowrap w-9 sm:w-auto">
                      {r.colPoints}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => {
                    const mine = row.user_id === me?.id;
                    const withdrew = !!row.withdrawn_at;
                    const prizeLabel = prizeForRank(row.rank);
                    const made = row.predictions_made ?? 0;
                    const streak = row.current_streak ?? 0;
                    const wildcards = row.wildcards_used ?? 0;
                    const special = row.special_bets_points ?? 0;
                    const stickyBg = withdrew
                      ? "bg-card"
                      : mine
                        ? "bg-accent"
                        : "bg-card";

                    return (
                      <tr
                        key={row.user_id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openHistory(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openHistory(row);
                          }
                        }}
                        className={cn(
                          "border-t border-border/60 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/50",
                          withdrew && "bg-destructive/5",
                          mine && !withdrew && "bg-accent/40",
                        )}
                      >
                        <td
                          className={cn(
                            "sticky left-0 z-[12] text-center px-0.5 sm:px-3 py-1.5 sm:py-2.5 font-bold tabular w-8 min-w-[2rem] sm:w-10",
                            stickyBg,
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex w-6 h-6 sm:w-8 sm:h-8 items-center justify-center rounded-full text-[10px] sm:text-sm",
                              row.rank === 1 && "gradient-gold text-gold-foreground",
                              row.rank === 2 && "gradient-silver text-silver-foreground",
                              row.rank === 3 && "gradient-bronze text-bronze-foreground",
                              row.rank > 3 &&
                                (withdrew
                                  ? "bg-destructive/20 text-destructive"
                                  : "bg-secondary text-secondary-foreground"),
                            )}
                          >
                            {row.rank}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "sticky left-8 sm:left-10 z-[11] px-1 sm:px-3 py-1.5 sm:py-2.5 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.18)] dark:shadow-[4px_0_6px_-4px_rgba(0,0,0,0.45)]",
                            stickyBg,
                          )}
                        >
                          <div className="flex items-center gap-1 sm:gap-2 min-w-0 max-w-[5.5rem] sm:max-w-none">
                            <PlayerAvatar
                              name={row.display_name}
                              avatarUrl={row.avatar_url}
                              fallback={r.player}
                              withdrew={withdrew}
                              className="w-5 h-5 sm:w-7 sm:h-7 text-[8px] sm:text-[10px]"
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  "font-semibold truncate text-[10px] sm:text-sm",
                                  withdrew && "text-destructive",
                                )}
                              >
                                {row.display_name ?? r.player}
                              </p>
                              <p className="hidden sm:flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                                {mine && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-primary text-primary-foreground uppercase tracking-wider">
                                    {r.you}
                                  </span>
                                )}
                                {withdrew && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-destructive text-destructive-foreground uppercase tracking-wider">
                                    {r.withdrew}
                                  </span>
                                )}
                                {streak > 0 && <StreakIndicator current={streak} />}
                                {wildcards > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-gold">
                                    <Star className="w-3 h-3 fill-current" />
                                    {wildcards}
                                  </span>
                                )}
                                {special > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-primary">
                                    <Sparkles className="w-3 h-3" />+{formatPoints(special)}
                                  </span>
                                )}
                              </p>
                              {(mine || withdrew) && (
                                <p className="sm:hidden mt-0.5">
                                  {mine && (
                                    <span className="text-[8px] px-1 py-px rounded bg-primary text-primary-foreground uppercase tracking-wider">
                                      {r.you}
                                    </span>
                                  )}
                                  {withdrew && (
                                    <span className="text-[8px] px-1 py-px rounded bg-destructive text-destructive-foreground uppercase tracking-wider">
                                      {r.withdrew}
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        {showPrizeCol && (
                          <td className="hidden sm:table-cell px-2 sm:px-3 py-2.5 tabular text-primary font-bold whitespace-nowrap">
                            {prizeLabel ?? ""}
                          </td>
                        )}
                        <td className="text-center px-1 sm:px-2 py-1.5 sm:py-2.5 tabular font-medium">
                          <span className="sm:hidden">{row.correct_count}</span>
                          <span className="hidden sm:inline">
                            {hitsLabel(row.correct_count, made, r.hitsFmt)}
                          </span>
                        </td>
                        <td className="text-center px-1 sm:px-2 py-1.5 sm:py-2.5 tabular font-semibold">
                          {row.exact_count}
                        </td>
                        {showSpecial && flags?.special_bet_winner_enabled && (
                          <td className="px-1 sm:px-2 py-1.5 sm:py-2.5 text-center sm:text-left">
                            {row.winner_team_id && teamById?.get(row.winner_team_id) ? (
                              <span className="inline-flex items-center justify-center sm:justify-start gap-1.5 min-w-0 sm:max-w-[9rem]">
                                <TeamBadge
                                  name={teamById.get(row.winner_team_id)!.name}
                                  shortName={teamById.get(row.winner_team_id)!.short_name}
                                  crestUrl={teamCrestUrl(teamById.get(row.winner_team_id))}
                                  size="sm"
                                />
                                <span className="hidden sm:inline truncate">
                                  {row.winner_team_name ??
                                    teamById.get(row.winner_team_id)!.short_name}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        {showSpecial && flags?.special_bet_support_team_enabled && (
                          <td className="hidden sm:table-cell px-2 py-2.5">
                            {row.support_team_id && teamById?.get(row.support_team_id) ? (
                              <span className="inline-flex items-center gap-1.5 min-w-0 max-w-[10rem]">
                                <TeamBadge
                                  name={teamById.get(row.support_team_id)!.name}
                                  shortName={teamById.get(row.support_team_id)!.short_name}
                                  crestUrl={teamCrestUrl(teamById.get(row.support_team_id))}
                                  size="sm"
                                />
                                <span className="truncate">
                                  {row.support_team_name}
                                  {row.support_advances != null ? ` (${row.support_advances})` : ""}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        {showSpecial && flags?.special_bet_top_scorer_enabled && (
                          <td className="px-1 sm:px-2 py-1.5 sm:py-2.5 text-center sm:text-left sm:max-w-[10rem]">
                            {row.top_scorer_name ? (
                              <span className="inline-flex items-center justify-center sm:justify-start gap-1 min-w-0">
                                <PlayerAvatar
                                  name={row.top_scorer_name}
                                  avatarUrl={row.top_scorer_photo_url}
                                  fallback={row.top_scorer_name}
                                  className="w-5 h-5 sm:w-6 sm:h-6 text-[8px] sm:text-[9px]"
                                />
                                <span className="sm:hidden tabular font-semibold text-[10px]">
                                  {row.top_scorer_goals != null ? row.top_scorer_goals : "-"}
                                </span>
                                <span className="hidden sm:inline truncate">{row.top_scorer_name}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        {showSpecial && flags?.special_bet_top_scorer_enabled && (
                          <td className="hidden sm:table-cell text-center px-2 py-2.5 tabular font-semibold">
                            {row.top_scorer_goals != null ? row.top_scorer_goals : "-"}
                          </td>
                        )}
                        {showSpecial && flags?.special_bet_best_defense_enabled && (
                          <td className="hidden sm:table-cell px-2 py-2.5">
                            {row.best_defense_team_id &&
                            teamById?.get(row.best_defense_team_id) ? (
                              <span className="inline-flex items-center gap-1.5 min-w-0 max-w-[9rem]">
                                <TeamBadge
                                  name={teamById.get(row.best_defense_team_id)!.name}
                                  shortName={teamById.get(row.best_defense_team_id)!.short_name}
                                  crestUrl={teamCrestUrl(teamById.get(row.best_defense_team_id))}
                                  size="sm"
                                />
                                <span className="truncate">{row.best_defense_team_name}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        <td
                          className={cn(
                            "text-right px-1 sm:px-3 py-1.5 sm:py-2.5 font-extrabold tabular text-sm sm:text-base whitespace-nowrap",
                            withdrew && "text-destructive",
                          )}
                        >
                          {formatPoints(row.total_points)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <UserPredictionsSheet
        open={!!historyUser}
        onOpenChange={(o) => !o && setHistoryUser(null)}
        tournamentId={id}
        userId={historyUser?.id ?? null}
        displayName={historyUser?.name ?? ""}
        summary={historyUser?.summary}
      />
    </div>
  );
}

function PodiumCards({
  rows,
  playerFallback,
  prizeForRank,
  onOpenHistory,
}: {
  rows: Ranked[];
  playerFallback: string;
  prizeForRank: (rank: number) => string | null;
  onOpenHistory: (row: Ranked) => void;
}) {
  const [g, s, b] = rows;
  return (
    <div className="grid grid-cols-3 gap-2">
      <MedalCard
        r={s}
        place={2}
        playerFallback={playerFallback}
        prizeLabel={prizeForRank(2)}
        onOpenHistory={() => onOpenHistory(s)}
      />
      <MedalCard
        r={g}
        place={1}
        playerFallback={playerFallback}
        prizeLabel={prizeForRank(1)}
        onOpenHistory={() => onOpenHistory(g)}
      />
      <MedalCard
        r={b}
        place={3}
        playerFallback={playerFallback}
        prizeLabel={prizeForRank(3)}
        onOpenHistory={() => onOpenHistory(b)}
      />
    </div>
  );
}

function MedalCard({
  r,
  place,
  playerFallback,
  prizeLabel,
  onOpenHistory,
}: {
  r: Ranked;
  place: 1 | 2 | 3;
  playerFallback: string;
  prizeLabel: string | null;
  onOpenHistory: () => void;
}) {
  const { t } = useT();
  const withdrew = !!r.withdrawn_at;
  const grad =
    place === 1
      ? "gradient-gold text-gold-foreground"
      : place === 2
        ? "gradient-silver text-silver-foreground"
        : "gradient-bronze text-bronze-foreground";
  const scale = place === 1 ? "sm:-translate-y-2" : "";
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpenHistory}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenHistory();
        }
      }}
      className={cn(
        "p-3 text-center shadow-card cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow",
        scale,
        withdrew && "border-destructive/60 bg-destructive/10",
      )}
    >
      <div className="flex items-center justify-center gap-1.5">
        <span
          className={`inline-flex w-11 h-11 rounded-full items-center justify-center font-bold ${grad}`}
        >
          {r.rank}
        </span>
        {prizeLabel && (
          <span className="text-xs font-bold tabular text-primary leading-tight">{prizeLabel}</span>
        )}
      </div>
      <div className="mt-2 flex flex-col items-center gap-1.5 min-w-0">
        <PlayerAvatar
          name={r.display_name}
          avatarUrl={r.avatar_url}
          fallback={playerFallback}
          withdrew={withdrew}
          className="w-10 h-10 text-xs"
        />
        <p className={cn("text-sm font-semibold truncate w-full", withdrew && "text-destructive")}>
          {r.display_name ?? playerFallback}
        </p>
      </div>
      {withdrew && (
        <p className="text-[10px] uppercase tracking-wider font-bold text-destructive mt-0.5">
          {t.ranking.withdrew}
        </p>
      )}
      <p className="text-lg font-extrabold tabular mt-0.5">
        {formatPoints(r.total_points)}
        <span className="text-[10px] font-medium text-muted-foreground ml-1">{t.common.points}</span>
      </p>
    </Card>
  );
}

function TiebreakDialog({
  showSupport,
  showScorerGoals,
}: {
  showSupport: boolean;
  showScorerGoals: boolean;
}) {
  const { t } = useT();
  const d = t.ranking.tiebreakDialog;
  const steps = [
    d.correct,
    d.exact,
    ...(showSupport ? [d.support] : []),
    ...(showScorerGoals ? [d.scorerGoals] : []),
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 sm:h-9 sm:w-auto sm:px-3" aria-label={t.ranking.tiebreakBtn}>
          <Scale className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">{t.ranking.tiebreakBtn}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>{d.desc}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2 text-sm list-decimal list-inside">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground mt-2">{d.shared}</p>
      </DialogContent>
    </Dialog>
  );
}

function PointsDialog({ tournamentId }: { tournamentId: string }) {
  const { t } = useT();
  const h = t.ranking.how;
  const { data: s } = useQuery({
    queryKey: ["settings", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select("*")
        .eq("tournament_id", tournamentId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 sm:h-9 sm:w-auto sm:px-3" aria-label={t.ranking.pointsBtn}>
          <HelpCircle className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">{t.ranking.pointsBtn}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{h.title}</DialogTitle>
          <DialogDescription>{h.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="font-semibold">{h.outcome}</p>
            <p className="text-muted-foreground">
              {h.outcomeDesc}{" "}
              <b className="text-primary">
                {s?.points_outcome ?? "…"} {t.common.points}
              </b>
              .
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-semibold">{h.exactBonus}</p>
            <p className="text-muted-foreground">
              {h.exactBonusDesc}{" "}
              <b className="text-primary">
                +{s?.points_exact_bonus ?? "…"} {t.common.points}
              </b>
              .
            </p>
          </div>
          {s?.wildcard_enabled && (
            <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
              <p className="font-semibold inline-flex items-center gap-1.5">
                <Star className="w-4 h-4 text-gold fill-current" /> {h.wildcard}
              </p>
              <p className="text-muted-foreground">
                {s.wildcard_per_round} {h.wildcardLine1}{" "}
                {s.wildcard_scope === "per_season" ? t.predictions.perSeason : t.predictions.perMatchday}.{" "}
                {h.wildcardLine2}
                <b className="text-gold ml-0.5">{s.wildcard_multiplier}</b>.
              </p>
            </div>
          )}
          {s?.win_streak_enabled && (
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3">
              <p className="font-semibold inline-flex items-center gap-1.5">🔥 {h.streak}</p>
              <p className="text-muted-foreground">
                {h.streakLine1} <b>{s.win_streak_threshold}</b> {h.streakLine2}{" "}
                <b className="text-orange-600 dark:text-orange-300">
                  +{s.win_streak_bonus} {t.common.points}
                </b>
                .
              </p>
              <p className="text-xs text-muted-foreground mt-1">{h.streakExtra}</p>
            </div>
          )}
          {s?.special_bets_enabled && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="font-semibold inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" /> {h.special}
              </p>
              <ul className="text-muted-foreground text-xs mt-1 space-y-0.5">
                {s.special_bet_winner_enabled && (
                  <li>
                    • {h.winnerLine} {s.points_winner} {t.common.points}
                  </li>
                )}
                {s.special_bet_support_team_enabled && (
                  <li>
                    • {h.supportTeamLine}{" "}
                    {interp(
                      s.support_team_mode === "champion"
                        ? h.supportTeamChampionExtra
                        : h.supportTeamExtra,
                      { x: s.points_support_advance },
                    )}
                  </li>
                )}
                {s.special_bet_top_scorer_enabled && (
                  <li>
                    •{" "}
                    {s.top_scorer_mode === "per_goal"
                      ? `${h.topScorerPerGoalLine} ${s.points_top_scorer_per_goal}`
                      : `${h.topScorerLine} ${s.points_top_scorer}`}{" "}
                    {t.common.points}
                  </li>
                )}
                {s.special_bet_best_defense_enabled && (
                  <li>
                    • {h.bestDefenseLine} {s.points_best_defense} {t.common.points}
                  </li>
                )}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{h.tiebreak}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
