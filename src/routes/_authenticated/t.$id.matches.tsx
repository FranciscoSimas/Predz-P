import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MatchdayNavigator, matchesForRoundView, pickDefaultRound, readStoredRound, writeStoredRound } from "@/components/MatchdayNavigator";
import { MatchScoreCompare, isMatchDisplayLive } from "@/components/MatchScoreCompare";
import { MatchScoreBoard, MatchTeamsRow } from "@/components/MatchTeamsRow";
import { CalendarDays, Search } from "lucide-react";
import { useT, fmt as interp } from "@/lib/i18n";
import { isCalendarPendingCompetition } from "@/lib/competition-format";
import { streakBonusByMatchId } from "@/lib/streak-bonus";
import {
  MatchPredictionsSheet,
  openMatchHistoryIfKickedOff,
} from "@/components/MatchPredictionsSheet";

export const Route = createFileRoute("/_authenticated/t/$id/matches")({
  component: MatchesPage,
});

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  crest_override_url?: string | null;
};

type Match = {
  id: string;
  round_or_matchday: number | null;
  kickoff_at: string;
  finished_at?: string | null;
  status: string;
  is_postponed?: boolean | null;
  home_score: number | null;
  away_score: number | null;
  home_team: Team | null;
  away_team: Team | null;
};

type MyPick = {
  match_id: string;
  home_pred: number | null;
  away_pred: number | null;
  points: number | null;
  exact: boolean | null;
  is_wildcard: boolean | null;
};

function MatchesPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/matches" });
  const { t } = useT();

  const { data: tournament } = useQuery({
    queryKey: ["tournament-comp-full", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("competition_id, competition:competitions(format, name, season, logo_url, slug)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const competitionSlug =
    (tournament?.competition as { slug?: string } | null | undefined)?.slug ?? null;

  const { data: matches, isLoading } = useQuery({
    queryKey: ["matches-full", tournament?.competition_id],
    enabled: !!tournament?.competition_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, round_or_matchday, kickoff_at, finished_at, status, is_postponed, home_score, away_score, home_team:home_team_id(id, name, short_name, crest_url, crest_override_url), away_team:away_team_id(id, name, short_name, crest_url, crest_override_url)",
        )
        .eq("competition_id", tournament!.competition_id)
        .order("kickoff_at");
      if (error) throw error;
      return data as unknown as Match[];
    },
  });

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h1 className="text-xl sm:text-2xl font-display tracking-wide">
            {t.matches.titleMatches}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t.matches.subtitleMatches}</p>
      </div>

      <MatchesList
        tournamentId={id}
        matches={matches}
        isLoading={isLoading}
        calendarPending={isCalendarPendingCompetition(competitionSlug)}
      />
    </div>
  );
}

function MatchesList({
  tournamentId,
  matches,
  isLoading,
  calendarPending = false,
}: {
  tournamentId: string;
  matches: Match[] | undefined;
  isLoading: boolean;
  calendarPending?: boolean;
}) {
  const { t } = useT();
  const roundScope = `${tournamentId}:matches`;
  const [round, setRound] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [historyMatch, setHistoryMatch] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const searching = q.trim().length > 0;

  const { data: myPicks } = useQuery({
    queryKey: ["predictions", tournamentId],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user!.id;
      const { data, error } = await supabase
        .from("prediction_entries")
        .select("match_id, home_pred, away_pred, points, exact, is_wildcard")
        .eq("tournament_id", tournamentId)
        .eq("user_id", uid);
      if (error) throw error;
      return (data ?? []) as MyPick[];
    },
  });

  const pickMap = useMemo(() => {
    const m = new Map<string, MyPick>();
    myPicks?.forEach((p) => m.set(p.match_id, p));
    return m;
  }, [myPicks]);

  const { data: settings } = useQuery({
    queryKey: ["settings", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select("win_streak_enabled, win_streak_threshold, win_streak_bonus")
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const streakBonusMap = useMemo(() => {
    if (!settings?.win_streak_enabled || !matches?.length) return new Map<string, number>();
    const finished = [...matches]
      .filter((m) => m.status === "finished")
      .sort((a, b) => {
        const ka = new Date(a.kickoff_at).getTime();
        const kb = new Date(b.kickoff_at).getTime();
        if (ka !== kb) return ka - kb;
        const fa = a.finished_at ? new Date(a.finished_at).getTime() : 0;
        const fb = b.finished_at ? new Date(b.finished_at).getTime() : 0;
        if (fa !== fb) return fa - fb;
        return a.id.localeCompare(b.id);
      });
    const pts = new Map<string, number | null | undefined>();
    for (const m of finished) {
      const pick = pickMap.get(m.id);
      pts.set(m.id, pick ? pick.points : null);
    }
    return streakBonusByMatchId(
      finished,
      pts,
      Number(settings.win_streak_threshold ?? 0),
      Number(settings.win_streak_bonus ?? 0),
    );
  }, [matches, pickMap, settings]);

  const rounds = useMemo(() => {
    const s = new Set<number>();
    matches?.forEach((m) => {
      if (m.round_or_matchday != null) s.add(m.round_or_matchday);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [matches]);

  const currentRound = useMemo(
    () => pickDefaultRound(matches ?? [], rounds),
    [matches, rounds],
  );

  useEffect(() => {
    if (rounds.length === 0) return;
    if (round != null && rounds.includes(round)) return;
    const stored = readStoredRound(roundScope);
    if (stored != null && rounds.includes(stored)) {
      setRound(stored);
      return;
    }
    setRound(currentRound);
  }, [round, rounds, currentRound, roundScope]);

  const selectRound = (next: number) => {
    setRound(next);
    writeStoredRound(roundScope, next);
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base =
      !query && round != null
        ? matchesForRoundView(matches ?? [], round, currentRound)
        : (matches ?? []);
    const list = base.filter((m) => {
      if (!query && round == null) return false;
      if (query) {
        const h = m.home_team?.name.toLowerCase() ?? "";
        const a = m.away_team?.name.toLowerCase() ?? "";
        const hs = m.home_team?.short_name?.toLowerCase() ?? "";
        const as = m.away_team?.short_name?.toLowerCase() ?? "";
        if (!h.includes(query) && !a.includes(query) && !hs.includes(query) && !as.includes(query)) {
          return false;
        }
      }
      return true;
    });
    return list.sort(
      (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
    );
  }, [matches, round, q, currentRound]);

  return (
    <div className="space-y-4 min-w-0">
      {!searching && rounds.length > 0 && (
        <MatchdayNavigator
          round={round}
          rounds={rounds}
          currentRound={currentRound}
          onChange={selectRound}
        />
      )}

      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.matches.searchTeam}
            className="pl-9 h-10"
          />
        </div>
        {searching && (
          <p className="text-xs text-muted-foreground px-0.5">{t.matches.searchAllHint}</p>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="w-7 h-7" />}
          title={t.matches.empty}
          description={
            searching
              ? t.matches.emptySearchDesc
              : !matches?.length
                ? calendarPending
                  ? t.matches.emptyCalendarPendingDesc
                  : t.matches.emptyCalendarDesc
                : t.matches.emptyDesc
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              pick={pickMap.get(m.id)}
              streakBonus={streakBonusMap.get(m.id) ?? null}
              showRound={searching}
              viewedRound={round}
              onOpenHistory={() =>
                openMatchHistoryIfKickedOff(
                  m.kickoff_at,
                  () =>
                    setHistoryMatch({
                      id: m.id,
                      title: `${m.home_team?.name || m.home_team?.short_name} vs ${m.away_team?.name || m.away_team?.short_name}`,
                    }),
                  t.ranking.history.afterKickoff,
                  m.status,
                )
              }
            />
          ))}
        </div>
      )}

      <MatchPredictionsSheet
        open={!!historyMatch}
        onOpenChange={(o) => !o && setHistoryMatch(null)}
        tournamentId={tournamentId}
        matchId={historyMatch?.id ?? null}
        title={historyMatch?.title ?? ""}
      />
    </div>
  );
}

function MatchCard({
  m,
  pick,
  streakBonus,
  showRound,
  viewedRound,
  onOpenHistory,
}: {
  m: Match;
  pick?: MyPick;
  streakBonus?: number | null;
  showRound?: boolean;
  viewedRound?: number | null;
  onOpenHistory: () => void;
}) {
  const { t, formatMatchTime } = useT();
  const isLive = isMatchDisplayLive(m.kickoff_at, m.status, !!m.is_postponed);
  const isFinished = m.status === "finished";
  const historyOpen =
    isLive || isFinished || new Date(m.kickoff_at) <= new Date();
  const showCompare =
    isFinished && m.home_score != null && m.away_score != null;
  const postponedLabel =
    m.is_postponed &&
    (m.round_or_matchday != null && viewedRound != null && m.round_or_matchday !== viewedRound
      ? interp(t.matches.postponedFromRound, { n: m.round_or_matchday })
      : t.matches.postponed);
  return (
    <Card
      role={historyOpen ? "button" : undefined}
      tabIndex={historyOpen ? 0 : undefined}
      onClick={onOpenHistory}
      onKeyDown={(e) => {
        if (!historyOpen) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenHistory();
        }
      }}
      className={`p-3 sm:p-4 shadow-card min-w-0 ${
        historyOpen ? "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow" : ""
      }`}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2.5 gap-2">
        <span className="min-w-0 truncate">
          {showRound && m.round_or_matchday != null && (
            <span className="font-semibold text-foreground/80 mr-1.5">
              {t.navigator.matchday} {m.round_or_matchday} ·
            </span>
          )}
          {formatMatchTime(m.kickoff_at)}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {postponedLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {postponedLabel}
            </span>
          )}
          {isLive ? (
            <LiveIndicator />
          ) : isFinished ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              {t.matches.finished}
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {t.matches.scheduled}
            </span>
          )}
        </div>
      </div>
      <MatchTeamsRow
        home={m.home_team}
        away={m.away_team}
        center={
          <MatchScoreBoard
            homeScore={m.home_score}
            awayScore={m.away_score}
            tone={isLive ? "live" : isFinished ? "finished" : "muted"}
          />
        }
      />
      {showCompare && (
        <MatchScoreCompare
          highlight="pick"
          streakBonus={streakBonus}
          homeScore={m.home_score}
          awayScore={m.away_score}
          pick={
            pick
              ? {
                  homePred: pick.home_pred,
                  awayPred: pick.away_pred,
                  points: pick.points,
                  exact: pick.exact,
                  isWildcard: pick.is_wildcard,
                }
              : null
          }
        />
      )}
    </Card>
  );
}
