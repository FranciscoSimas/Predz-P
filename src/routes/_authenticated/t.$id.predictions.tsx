import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { LiveIndicator } from "@/components/LiveIndicator";
import { Binoculars, Lock, ListChecks, Save, Star, Sparkles, Search } from "lucide-react";
import { toast } from "sonner";
import { TeamBadge } from "@/components/TeamBadge";
import { TopScorerPickerDialog } from "@/components/TopScorerPickerDialog";
import { WildcardBadge } from "@/components/WildcardBadge";
import { StreakIndicator } from "@/components/StreakIndicator";
import { MatchdayNavigator, matchesForRoundView, pickDefaultRound, readStoredRound, writeStoredRound } from "@/components/MatchdayNavigator";
import { isMatchPickLocked, isMatchDisplayLive, MatchScoreCompare } from "@/components/MatchScoreCompare";
import { MatchTeamsRow } from "@/components/MatchTeamsRow";
import { useT, fmt as interp } from "@/lib/i18n";
import { teamCrestUrl } from "@/lib/team-crest";
import { streakBonusByMatchId } from "@/lib/streak-bonus";
import { isKnockoutishFormat, isLeagueFormat, isCalendarPendingCompetition } from "@/lib/competition-format";
import {
  type LegKind,
  allowsEtPen,
  canOpenEt,
  canOpenPens,
  aggregateFromPerspective,
  liveFirstLegScores,
  phaseRoundLabelPt,
  phaseRoundLabelEn,
  effectiveLegKind,
} from "@/lib/knockout-aggregate";
import {
  MatchPredictionsSheet,
  openMatchHistoryIfKickedOff,
} from "@/components/MatchPredictionsSheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/t/$id/predictions")({
  component: PredictionsPage,
});


type Team = {
  id?: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  crest_override_url?: string | null;
};
type Match = {
  id: string;
  round_or_matchday: number | null;
  phase: string | null;
  tie_id: string | null;
  leg_kind: string | null;
  kickoff_at: string;
  finished_at?: string | null;
  status: string;
  is_postponed?: boolean | null;
  home_score: number | null;
  away_score: number | null;
  et_home_score: number | null;
  et_away_score: number | null;
  pen_home_score: number | null;
  pen_away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: Team | null;
  away_team: Team | null;
};
type Draft = { h: string; a: string; eh: string; ea: string; ph: string; pa: string; wc: boolean };
const EMPTY_DRAFT: Draft = { h: "", a: "", eh: "", ea: "", ph: "", pa: "", wc: false };
function draftNum(s: string): number | null {
  return s === "" ? null : Number(s);
}

function PredictionsPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/predictions" });
  const qc = useQueryClient();
  const { t, formatMatchTime, locale } = useT();
  const p = t.predictions;

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: myMembership, isLoading: membershipLoading } = useQuery({
    queryKey: ["my-membership", id, me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_members")
        .select("role, withdrawn_at")
        .eq("tournament_id", id)
        .eq("user_id", me!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const withdrawn = !!myMembership?.withdrawn_at;
  const spectator = myMembership?.role === "spectator";

  const { data: tournament } = useQuery({
    queryKey: ["tournament-comp", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("competition_id, competition:competitions(format, slug)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as {
        competition_id: string;
        competition: { format: string; slug: string } | null;
      };
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["settings", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select("*")
        .eq("tournament_id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: streak } = useQuery({
    queryKey: ["my-streak", id],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user!.id;
      const { data } = await supabase
        .from("tournament_member_streaks")
        .select("current_streak, best_streak, bonus_points")
        .eq("tournament_id", id)
        .eq("user_id", uid)
        .maybeSingle();
      return data;
    },
  });

  const { data: matches } = useQuery({
    queryKey: ["matches", tournament?.competition_id],
    enabled: !!tournament?.competition_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, round_or_matchday, phase, tie_id, leg_kind, kickoff_at, finished_at, status, is_postponed, home_score, away_score, et_home_score, et_away_score, pen_home_score, pen_away_score, home_team_id, away_team_id, home_team:home_team_id(id, name, short_name, crest_url, crest_override_url), away_team:away_team_id(id, name, short_name, crest_url, crest_override_url)",
        )
        .eq("competition_id", tournament!.competition_id)
        .order("kickoff_at");
      if (error) throw error;
      return data as unknown as Match[];
    },
  });

  const { data: predictions } = useQuery({
    queryKey: ["predictions", id],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user!.id;
      const { data, error } = await supabase
        .from("prediction_entries")
        .select(
          "match_id, home_pred, away_pred, et_home_pred, et_away_pred, pen_home_pred, pen_away_pred, points, exact, is_wildcard, points_advancement, points_90, points_et, points_pen, points_before_multiplier",
        )
        .eq("tournament_id", id)
        .eq("user_id", uid);
      if (error) throw error;
      return data ?? [];
    },
  });

  const predMap = useMemo(() => {
    const m = new Map<
      string,
      {
        home_pred: number | null;
        away_pred: number | null;
        et_home_pred: number | null;
        et_away_pred: number | null;
        pen_home_pred: number | null;
        pen_away_pred: number | null;
        points: number | null;
        exact: boolean | null;
        is_wildcard: boolean | null;
        points_advancement: number | null;
        points_90: number | null;
        points_et: number | null;
        points_pen: number | null;
        points_before_multiplier: number | null;
      }
    >();
    predictions?.forEach((row) => {
      if (row.match_id) m.set(row.match_id, row);
    });
    return m;
  }, [predictions]);

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
      const pred = predMap.get(m.id);
      pts.set(m.id, pred ? pred.points : null);
    }
    return streakBonusByMatchId(
      finished,
      pts,
      Number(settings.win_streak_threshold ?? 0),
      Number(settings.win_streak_bonus ?? 0),
    );
  }, [matches, predMap, settings]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [historyMatch, setHistoryMatch] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (!predictions) return;
    const next: Record<string, Draft> = {};
    predictions.forEach((row) => {
      if (!row.match_id) return;
      next[row.match_id] = {
        h: row.home_pred?.toString() ?? "",
        a: row.away_pred?.toString() ?? "",
        eh: row.et_home_pred?.toString() ?? "",
        ea: row.et_away_pred?.toString() ?? "",
        ph: row.pen_home_pred?.toString() ?? "",
        pa: row.pen_away_pred?.toString() ?? "",
        wc: !!row.is_wildcard,
      };
    });
    setDrafts(next);
  }, [predictions]);

  useEffect(() => {
    if (!tournament?.competition_id) return;
    const competitionId = tournament.competition_id;
    const channels: ReturnType<typeof supabase.channel>[] = [];

    const matchChannel = supabase
      .channel(`preds-${id}-${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `competition_id=eq.${competitionId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["matches", competitionId] });
          qc.invalidateQueries({ queryKey: ["predictions"] });
          qc.invalidateQueries({ queryKey: ["leaderboard", id] });
          qc.invalidateQueries({ queryKey: ["my-streak", id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "predictions",
          filter: `tournament_id=eq.${id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["predictions"] });
          qc.invalidateQueries({ queryKey: ["leaderboard", id] });
          qc.invalidateQueries({ queryKey: ["my-streak", id] });
        },
      )
      .subscribe();
    channels.push(matchChannel);

    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const picksChannel = supabase
        .channel(`picks-${uid}-${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_match_picks",
            filter: `user_id=eq.${uid}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: ["predictions"] });
            qc.invalidateQueries({ queryKey: ["leaderboard"] });
          },
        )
        .subscribe();
      channels.push(picksChannel);
    });

    return () => {
      cancelled = true;
      channels.forEach((ch) => {
        void supabase.removeChannel(ch);
      });
    };
  }, [id, tournament?.competition_id, qc]);

  const rounds = useMemo(() => {
    const s = new Set<number>();
    matches?.forEach((m) => {
      if (m.round_or_matchday != null) s.add(m.round_or_matchday);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [matches]);
  const roundLabels = useMemo(() => {
    if (!isKnockoutishFormat(tournament?.competition?.format) || !matches?.length) return undefined;
    const labelFn = locale === "en" ? phaseRoundLabelEn : phaseRoundLabelPt;
    const out: Record<number, string> = {};
    for (const m of matches) {
      if (m.round_or_matchday == null || out[m.round_or_matchday] != null) continue;
      out[m.round_or_matchday] = labelFn(m.phase, m.round_or_matchday);
    }
    return out;
  }, [matches, tournament?.competition?.format, locale]);
  const roundScope = `${id}:predictions`;
  const [round, setRound] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const searching = q.trim().length > 0;
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
  const visible = useMemo(() => {
    if (!matches) return [];
    const query = q.trim().toLowerCase();
    if (query) {
      return [...matches]
        .filter((m) => {
          const h = m.home_team?.name.toLowerCase() ?? "";
          const a = m.away_team?.name.toLowerCase() ?? "";
          const hs = m.home_team?.short_name?.toLowerCase() ?? "";
          const as = m.away_team?.short_name?.toLowerCase() ?? "";
          return h.includes(query) || a.includes(query) || hs.includes(query) || as.includes(query);
        })
        .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());
    }
    if (round == null) return [];
    return matchesForRoundView(matches, round, currentRound);
  }, [matches, round, currentRound, q]);

  const wildcardEnabled = !!settings?.wildcard_enabled;
  const wildcardMultiplier = settings?.wildcard_multiplier ?? 2;
  const wildcardPerRound = settings?.wildcard_per_round ?? 1;
  const wildcardScope = settings?.wildcard_scope ?? "per_matchday";

  // Count wildcards used per matchday from drafts
  const wildcardCountByRound = useMemo(() => {
    const m = new Map<number, number>();
    for (const match of matches ?? []) {
      const d = drafts[match.id];
      if (d?.wc) {
        const r = match.round_or_matchday ?? 0;
        m.set(r, (m.get(r) ?? 0) + 1);
      }
    }
    return m;
  }, [drafts, matches]);
  const totalWildcards = useMemo(
    () => Array.from(wildcardCountByRound.values()).reduce((a, b) => a + b, 0),
    [wildcardCountByRound],
  );

  const changedCount = useMemo(() => {
    let n = 0;
    for (const m of visible) {
      const d = drafts[m.id];
      if (!d) continue;
      if (isMatchPickLocked(m.kickoff_at, m.status, withdrawn, !!m.is_postponed)) continue;
      const h = draftNum(d.h);
      const a = draftNum(d.a);
      if (h === null || a === null) continue;
      const eh = draftNum(d.eh);
      const ea = draftNum(d.ea);
      const ph = draftNum(d.ph);
      const pa = draftNum(d.pa);
      const pred = predMap.get(m.id);
      if (
        !pred ||
        pred.home_pred !== h ||
        pred.away_pred !== a ||
        (pred.et_home_pred ?? null) !== eh ||
        (pred.et_away_pred ?? null) !== ea ||
        (pred.pen_home_pred ?? null) !== ph ||
        (pred.pen_away_pred ?? null) !== pa ||
        !!pred.is_wildcard !== !!d.wc
      ) {
        n++;
      }
    }
    return n;
  }, [drafts, visible, predMap, withdrawn]);

  const missing = useMemo(
    () =>
      visible.filter(
        (m) => !isMatchPickLocked(m.kickoff_at, m.status, withdrawn, !!m.is_postponed) && !predMap.get(m.id),
      ).length,
    [visible, predMap, withdrawn],
  );

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (changedCount > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [changedCount]);

  function toggleWildcard(matchId: string, matchday: number | null) {
    const match = (matches ?? []).find((m) => m.id === matchId);
    if (match && isMatchPickLocked(match.kickoff_at, match.status, withdrawn, !!match.is_postponed)) return;
    const d = drafts[matchId] ?? { ...EMPTY_DRAFT };
    if (d.wc) {
      setDrafts((prev) => ({ ...prev, [matchId]: { ...d, wc: false } }));
      return;
    }
    // Validate limit
    if (wildcardScope === "per_season") {
      if (totalWildcards >= wildcardPerRound) {
        toast.error(interp(p.wildcardLimitSeason, { n: wildcardPerRound }));
        return;
      }
    } else {
      const used = wildcardCountByRound.get(matchday ?? 0) ?? 0;
      if (used >= wildcardPerRound) {
        toast.error(interp(p.wildcardLimitRound, { n: wildcardPerRound }));
        return;
      }
    }
    setDrafts((prev) => ({ ...prev, [matchId]: { ...d, wc: true } }));
  }

  function tryChangeRound(next: number) {
    if (next === round) return;
    if (
      changedCount > 0 &&
      !window.confirm(interp(p.unsavedConfirm, { n: changedCount }))
    ) {
      return;
    }
    // Reset drafts for the leaving round back to server values
    if (changedCount > 0) {
      setDrafts((prev) => {
        const nextDrafts = { ...prev };
        (predictions ?? []).forEach((row) => {
          if (!row.match_id) return;
          nextDrafts[row.match_id] = {
            h: row.home_pred?.toString() ?? "",
            a: row.away_pred?.toString() ?? "",
            eh: row.et_home_pred?.toString() ?? "",
            ea: row.et_away_pred?.toString() ?? "",
            ph: row.pen_home_pred?.toString() ?? "",
            pa: row.pen_away_pred?.toString() ?? "",
            wc: !!row.is_wildcard,
          };
        });
        return nextDrafts;
      });
    }
    setRound(next);
    writeStoredRound(roundScope, next);
  }

  const [saving, setSaving] = useState(false);
  async function saveAll() {
    if (spectator) {
      toast.error(t.join.spectatorPredictionsDesc);
      return;
    }
    if (withdrawn) {
      toast.error(t.info.withdrawnBanner);
      return;
    }
    if (changedCount === 0) {
      toast.info(p.nothingToSave);
      return;
    }
    setSaving(true);
    const pending: Array<{
      match_id: string;
      home_pred: number;
      away_pred: number;
      et_home_pred: number | null;
      et_away_pred: number | null;
      pen_home_pred: number | null;
      pen_away_pred: number | null;
      is_wildcard: boolean;
    }> = [];
    for (const m of matches ?? []) {
      const d = drafts[m.id];
      if (!d) continue;
      if (isMatchPickLocked(m.kickoff_at, m.status, withdrawn, !!m.is_postponed)) continue;
      const h = draftNum(d.h);
      const a = draftNum(d.a);
      if (h === null || a === null) continue;
      const eh = draftNum(d.eh);
      const ea = draftNum(d.ea);
      const ph = draftNum(d.ph);
      const pa = draftNum(d.pa);
      const existing = predMap.get(m.id);
      if (
        existing &&
        existing.home_pred === h &&
        existing.away_pred === a &&
        (existing.et_home_pred ?? null) === eh &&
        (existing.et_away_pred ?? null) === ea &&
        (existing.pen_home_pred ?? null) === ph &&
        (existing.pen_away_pred ?? null) === pa &&
        !!existing.is_wildcard === !!d.wc
      ) {
        continue;
      }
      pending.push({
        match_id: m.id,
        home_pred: h,
        away_pred: a,
        et_home_pred: eh,
        et_away_pred: ea,
        pen_home_pred: ph,
        pen_away_pred: pa,
        is_wildcard: !!d.wc && wildcardEnabled,
      });
    }

    if (pending.length === 0) {
      setSaving(false);
      toast.info(p.nothingToSave);
      return;
    }

    let maxSynced = 1;
    const { data, error } = await supabase.rpc("upsert_shared_match_predictions_batch", {
      _tournament_id: id,
      _items: pending,
    });
    setSaving(false);
    if (error) {
      return toast.error(error.message);
    }
    maxSynced = (data as { synced_tournaments?: number } | null)?.synced_tournaments ?? 1;
    const saved = (data as { saved?: number } | null)?.saved ?? pending.length;

    toast.success(
      maxSynced > 1
        ? interp(p.savedShared, { n: saved, t: maxSynced })
        : interp(p.savedN, { n: saved }),
    );
    qc.invalidateQueries({ queryKey: ["predictions"] });
    qc.invalidateQueries({ queryKey: ["leaderboard"] });
    qc.invalidateQueries({ queryKey: ["my-streak"] });
  }

  if (membershipLoading) {
    return <div className="h-40 rounded-xl bg-muted animate-pulse" />;
  }

  if (spectator) {
    return (
      <EmptyState
        icon={<Binoculars className="h-7 w-7" />}
        title={t.join.spectatorPredictionsTitle}
        description={t.join.spectatorPredictionsDesc}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/t/$id/matches" params={{ id }}>
                {t.nav.matches}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/t/$id/ranking" params={{ id }}>
                {t.nav.ranking}
              </Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <ListChecks className="w-5 h-5 text-primary" />
          <h1 className="text-xl sm:text-2xl font-display tracking-wide">{p.title}</h1>
          {settings?.win_streak_enabled && streak != null && (
            <StreakIndicator
              current={streak.current_streak ?? 0}
              best={streak.best_streak ?? 0}
              className="ml-1"
            />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{p.subtitle}</p>
        {withdrawn && (
          <Card className="mt-3 p-3 border-destructive/50 bg-destructive/10 text-sm text-destructive">
            {t.info.withdrawnBanner}
          </Card>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {missing > 0 && (
            <span className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary font-medium">
              <ListChecks className="w-3.5 h-3.5" /> {interp(p.missing, { n: missing })}
            </span>
          )}
          {wildcardEnabled && (
            <span className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gold/20 text-gold-foreground dark:text-gold font-medium border border-gold/50">
              <Star className="w-3.5 h-3.5" /> {p.wildcardsLabel}{" "}
              {wildcardScope === "per_season"
                ? `${totalWildcards}/${wildcardPerRound} (${p.perSeason})`
                : round != null
                  ? `${wildcardCountByRound.get(round) ?? 0}/${wildcardPerRound} (${p.perMatchday})`
                  : `${wildcardPerRound}/${p.perMatchday}`}
            </span>
          )}
        </div>
      </div>

      {settings?.special_bets_enabled && (
        <SpecialBetsSection
          tournamentId={id}
          competitionId={tournament?.competition_id ?? ""}
          competitionFormat={tournament?.competition?.format ?? null}
          settings={settings as Settings}
          withdrawn={withdrawn}
        />
      )}

      {!searching && rounds.length > 0 && (
        <MatchdayNavigator
          round={round}
          rounds={rounds}
          currentRound={currentRound}
          onChange={tryChangeRound}
          roundLabels={roundLabels}
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

      {!matches ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="w-7 h-7" />}
          title={p.emptyTitle}
          description={
            isCalendarPendingCompetition(tournament?.competition?.slug)
              ? p.emptyDescPending
              : p.emptyDesc
          }
        />
      ) : (
        <>
          {visible.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="w-7 h-7" />}
              title={searching ? t.matches.empty : p.emptyTitle}
              description={searching ? t.matches.emptySearchDesc : p.emptyDesc}
            />
          ) : (
          <div className="space-y-2 pb-28 sm:pb-24">
            {visible.map((m) => {
                  const locked = isMatchPickLocked(m.kickoff_at, m.status, withdrawn, !!m.is_postponed);
                  const d = drafts[m.id] ?? { ...EMPTY_DRAFT };
                  const pred = predMap.get(m.id);
                  const isLive = isMatchDisplayLive(m.kickoff_at, m.status, !!m.is_postponed);
                  const showCompare =
                    m.status === "finished" && m.home_score !== null && m.away_score !== null;
                  const original = pred
                    ? {
                        h: pred.home_pred?.toString() ?? "",
                        a: pred.away_pred?.toString() ?? "",
                        eh: pred.et_home_pred?.toString() ?? "",
                        ea: pred.et_away_pred?.toString() ?? "",
                        ph: pred.pen_home_pred?.toString() ?? "",
                        pa: pred.pen_away_pred?.toString() ?? "",
                        wc: !!pred.is_wildcard,
                      }
                    : null;
                  const changed =
                    !locked &&
                    original &&
                    (original.h !== d.h ||
                      original.a !== d.a ||
                      original.eh !== d.eh ||
                      original.ea !== d.ea ||
                      original.ph !== d.ph ||
                      original.pa !== d.pa ||
                      original.wc !== d.wc) &&
                    d.h !== "" &&
                    d.a !== "";
                  const postponedLabel =
                    m.is_postponed &&
                    (m.round_or_matchday != null &&
                    (searching || (round != null && m.round_or_matchday !== round))
                      ? interp(t.matches.postponedFromRound, { n: m.round_or_matchday })
                      : t.matches.postponed);

                  const knockoutComp = isKnockoutishFormat(tournament?.competition?.format);
                  const legKind = effectiveLegKind(m.leg_kind, m.phase, knockoutComp);
                  const hNum = draftNum(d.h);
                  const aNum = draftNum(d.a);
                  const ehNum = draftNum(d.eh);
                  const eaNum = draftNum(d.ea);
                  const homeTeamId = m.home_team_id ?? m.home_team?.id ?? "";
                  const awayTeamId = m.away_team_id ?? m.away_team?.id ?? "";
                  const firstLeg =
                    legKind === "second" && m.tie_id
                      ? (matches ?? []).find(
                          (o) => o.tie_id === m.tie_id && o.leg_kind === "first" && o.id !== m.id,
                        )
                      : undefined;
                  const firstLegGate = firstLeg
                    ? {
                        homeTeamId: firstLeg.home_team_id ?? firstLeg.home_team?.id ?? "",
                        awayTeamId: firstLeg.away_team_id ?? firstLeg.away_team?.id ?? "",
                        finished: firstLeg.status === "finished",
                        homeScore: firstLeg.home_score,
                        awayScore: firstLeg.away_score,
                        homePred: predMap.get(firstLeg.id)?.home_pred ?? null,
                        awayPred: predMap.get(firstLeg.id)?.away_pred ?? null,
                      }
                    : null;
                  const openEt =
                    allowsEtPen(legKind) &&
                    canOpenEt({
                      legKind,
                      home90: hNum,
                      away90: aNum,
                      firstLeg: firstLegGate,
                      second: { homeTeamId, awayTeamId },
                    });
                  const openPens = openEt && canOpenPens(ehNum, eaNum);

                  let aggregateText: string | null = null;
                  if (legKind === "second" && firstLegGate && hNum != null && aNum != null) {
                    const firstScores = liveFirstLegScores({
                      firstFinished: firstLegGate.finished,
                      firstHomeScore: firstLegGate.homeScore,
                      firstAwayScore: firstLegGate.awayScore,
                      firstHomePred: firstLegGate.homePred,
                      firstAwayPred: firstLegGate.awayPred,
                    });
                    if (firstScores) {
                      const agg = aggregateFromPerspective(
                        {
                          homeTeamId: firstLegGate.homeTeamId,
                          awayTeamId: firstLegGate.awayTeamId,
                          home: firstScores.home,
                          away: firstScores.away,
                        },
                        {
                          homeTeamId,
                          awayTeamId,
                          home: hNum,
                          away: aNum,
                        },
                        "second",
                      );
                      if (agg) aggregateText = `${p.aggregateLabel}: ${agg.home}-${agg.away}`;
                    }
                  }

                  const applyGateClear = (next: Draft): Draft => {
                    const nextH = draftNum(next.h);
                    const nextA = draftNum(next.a);
                    const etOpen =
                      allowsEtPen(legKind) &&
                      canOpenEt({
                        legKind,
                        home90: nextH,
                        away90: nextA,
                        firstLeg: firstLegGate,
                        second: { homeTeamId, awayTeamId },
                      });
                    if (!etOpen) {
                      return { ...next, eh: "", ea: "", ph: "", pa: "" };
                    }
                    const nextEh = draftNum(next.eh);
                    const nextEa = draftNum(next.ea);
                    if (!canOpenPens(nextEh, nextEa)) {
                      return { ...next, ph: "", pa: "" };
                    }
                    return next;
                  };

                  const openHistory = () =>
                    openMatchHistoryIfKickedOff(
                      m.kickoff_at,
                      () =>
                        setHistoryMatch({
                          id: m.id,
                          title: `${m.home_team?.name || m.home_team?.short_name} vs ${m.away_team?.name || m.away_team?.short_name}`,
                        }),
                      t.ranking.history.afterKickoff,
                      m.status,
                    );
                  return (
                    <Card
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      onClick={openHistory}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openHistory();
                        }
                      }}
                      className={`p-3 sm:p-4 shadow-card min-w-0 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow ${changed ? "ring-2 ring-primary/30 border-primary/30" : ""} ${d.wc && !locked ? "border-gold/60 bg-gold/5" : ""}`}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2.5 gap-2">
                        <span className="min-w-0 truncate">
                          {searching && m.round_or_matchday != null && (
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
                          {d.wc && <WildcardBadge multiplier={wildcardMultiplier} />}
                          {isLive ? (
                            <LiveIndicator />
                          ) : locked ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Lock className="w-3 h-3" /> {p.locked}
                            </span>
                          ) : (
                            <span className="text-primary font-semibold text-[10px] uppercase tracking-wider">
                              {p.open}
                            </span>
                          )}
                        </div>
                      </div>
                      <MatchTeamsRow
                        home={m.home_team}
                        away={m.away_team}
                        center={
                          <div
                            className="flex flex-col items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={30}
                                className="w-12 sm:w-14 h-11 sm:h-12 text-center text-base sm:text-lg font-bold tabular"
                                value={d.h}
                                disabled={locked}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [m.id]: applyGateClear({ ...d, h: e.target.value }),
                                  }))
                                }
                              />
                              <span className="text-muted-foreground font-bold">:</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={30}
                                className="w-12 sm:w-14 h-11 sm:h-12 text-center text-base sm:text-lg font-bold tabular"
                                value={d.a}
                                disabled={locked}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [m.id]: applyGateClear({ ...d, a: e.target.value }),
                                  }))
                                }
                              />
                            </div>
                            {openEt && (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                  {p.etLabel}
                                </span>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={30}
                                    className="w-12 sm:w-14 h-9 text-center text-sm font-bold tabular"
                                    value={d.eh}
                                    disabled={locked}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: applyGateClear({ ...d, eh: e.target.value }),
                                      }))
                                    }
                                  />
                                  <span className="text-muted-foreground font-bold">:</span>
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={30}
                                    className="w-12 sm:w-14 h-9 text-center text-sm font-bold tabular"
                                    value={d.ea}
                                    disabled={locked}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: applyGateClear({ ...d, ea: e.target.value }),
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                            {openPens && (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                  {p.penLabel}
                                </span>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={30}
                                    className="w-12 sm:w-14 h-9 text-center text-sm font-bold tabular"
                                    value={d.ph}
                                    disabled={locked}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: { ...d, ph: e.target.value },
                                      }))
                                    }
                                  />
                                  <span className="text-muted-foreground font-bold">:</span>
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={30}
                                    className="w-12 sm:w-14 h-9 text-center text-sm font-bold tabular"
                                    value={d.pa}
                                    disabled={locked}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: { ...d, pa: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                            {aggregateText && (
                              <p className="text-[11px] text-muted-foreground font-medium tabular">
                                {aggregateText}
                              </p>
                            )}
                          </div>
                        }
                      />
                      {wildcardEnabled && !locked && (
                        <div className="mt-2.5 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleWildcard(m.id, m.round_or_matchday);
                            }}
                            className={`inline-flex items-center gap-1 h-9 px-3 rounded-md text-xs font-semibold transition-colors ${
                              d.wc
                                ? "bg-gold text-gold-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                            aria-pressed={d.wc}
                          >
                            <Star className={`w-3.5 h-3.5 ${d.wc ? "fill-current" : ""}`} />
                            {d.wc ? `${p.wildcardOn} ×${wildcardMultiplier}` : `${p.wildcardMark} ×${wildcardMultiplier}`}
                          </button>
                        </div>
                      )}
                      {showCompare && (
                        <MatchScoreCompare
                          highlight="real"
                          homeScore={m.home_score}
                          awayScore={m.away_score}
                          streakBonus={streakBonusMap.get(m.id) ?? null}
                          pick={
                            pred
                              ? {
                                  homePred: pred.home_pred,
                                  awayPred: pred.away_pred,
                                  points: pred.points,
                                  exact: pred.exact,
                                  isWildcard: pred.is_wildcard,
                                  pointsAdvancement: pred.points_advancement,
                                  points90: pred.points_90,
                                  pointsEt: pred.points_et,
                                  pointsPen: pred.points_pen,
                                  pointsBeforeMultiplier: pred.points_before_multiplier,
                                }
                              : d.h !== "" && d.a !== ""
                                ? {
                                    homePred: Number(d.h),
                                    awayPred: Number(d.a),
                                    points: null,
                                    exact: null,
                                    isWildcard: d.wc,
                                  }
                                : null
                          }
                        />
                      )}
                    </Card>
                  );
                })}
          </div>
          )}

          <div className="sticky bottom-20 sm:bottom-4 z-10 pt-2 pb-1">
            <div className="bg-card border shadow-card rounded-xl p-2 flex flex-col xs:flex-row items-stretch xs:items-center gap-2">
              <div className="flex-1 min-w-0 px-2 text-sm">
                {changedCount > 0 ? (
                  <span className="font-medium truncate block">
                    {interp(p.unsavedShort, { n: changedCount })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{p.allSaved}</span>
                )}
              </div>
              <Button
                onClick={saveAll}
                disabled={saving || changedCount === 0 || withdrawn}
                className="h-11 w-full xs:w-auto xs:min-w-[8rem] shrink-0"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {saving ? t.common.saving : p.save}
              </Button>
            </div>
          </div>
        </>
      )}

      <MatchPredictionsSheet
        open={!!historyMatch}
        onOpenChange={(o) => !o && setHistoryMatch(null)}
        tournamentId={id}
        matchId={historyMatch?.id ?? null}
        title={historyMatch?.title ?? ""}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// APOSTAS ESPECIAIS

type Settings = {
  special_bets_enabled: boolean;
  special_bet_winner_enabled: boolean;
  special_bet_support_team_enabled: boolean;
  special_bet_top_scorer_enabled: boolean;
  special_bet_best_defense_enabled: boolean;
  points_winner: number;
  points_support_advance: number;
  support_team_mode: string;
  points_top_scorer: number;
  points_top_scorer_per_goal: number;
  points_best_defense: number;
  top_scorer_mode: string;
  special_bets_cutoff_at: string | null;
};

function SpecialBetsSection({
  tournamentId,
  competitionId,
  competitionFormat,
  settings,
  withdrawn = false,
}: {
  tournamentId: string;
  competitionId: string;
  competitionFormat: string | null;
  settings: Settings;
  withdrawn?: boolean;
}) {
  const qc = useQueryClient();
  const { t, formatDay, dateLocale } = useT();
  const sp = t.special;
  const cutoff = settings.special_bets_cutoff_at ? new Date(settings.special_bets_cutoff_at) : null;
  const locked = withdrawn || (cutoff ? cutoff <= new Date() : false);
  const showWinner = isLeagueFormat(competitionFormat) && settings.special_bet_winner_enabled;
  const showSupport =
    isKnockoutishFormat(competitionFormat) && settings.special_bet_support_team_enabled;
  const topScorerPoints =
    settings.top_scorer_mode === "per_goal"
      ? settings.points_top_scorer_per_goal
      : settings.points_top_scorer;

  const { data: teams } = useQuery({
    queryKey: ["comp-teams", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_teams")
        .select("id, name, short_name, crest_url, crest_override_url")
        .eq("competition_id", competitionId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: myBets } = useQuery({
    queryKey: ["my-special-bets", tournamentId],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user!.id;
      const { data, error } = await supabase
        .from("special_bets")
        .select("bet_type, value, team_id, points, player_external_id")
        .eq("tournament_id", tournamentId)
        .eq("user_id", uid);
      if (error) throw error;
      return data ?? [];
    },
  });

  const winnerBet = myBets?.find((b) => b.bet_type === "winner");
  const supportBet = myBets?.find((b) => b.bet_type === "support_team");
  const topBet = myBets?.find((b) => b.bet_type === "top_scorer");
  const defBet = myBets?.find((b) => b.bet_type === "best_defense");

  const [winner, setWinner] = useState<string>("");
  const [supportTeam, setSupportTeam] = useState<string>("");
  const [topScorer, setTopScorer] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bestDef, setBestDef] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWinner(winnerBet?.team_id ?? "");
    setSupportTeam(supportBet?.team_id ?? "");
    setTopScorer(topBet?.value ?? "");
    setBestDef(defBet?.team_id ?? "");
  }, [
    winnerBet?.team_id,
    supportBet?.team_id,
    topBet?.value,
    defBet?.team_id,
  ]);

  async function saveBet(
    bet_type: "winner" | "top_scorer" | "best_defense" | "support_team",
    value: string,
    team_id: string | null,
    player_external_id?: string | null,
  ) {
    if (!value) return;
    setSaving(true);
    const { data: uRes } = await supabase.auth.getUser();
    const uid = uRes.user!.id;
    const payload: {
      tournament_id: string;
      user_id: string;
      bet_type: typeof bet_type;
      value: string;
      team_id: string | null;
      player_external_id?: string | null;
    } = {
      tournament_id: tournamentId,
      user_id: uid,
      bet_type,
      value,
      team_id,
    };
    if (bet_type === "top_scorer") {
      payload.player_external_id = player_external_id ?? null;
    }
    const { error } = await supabase.from("special_bets").upsert(payload, {
      onConflict: "tournament_id,user_id,bet_type",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(sp.savedOk);
    qc.invalidateQueries({ queryKey: ["my-special-bets", tournamentId] });
  }

  return (
    <Card className="p-4 shadow-card space-y-3 border-primary/20">
      <div className="flex items-start gap-2">
        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-bold">{sp.title}</h2>
          <p className="text-xs text-muted-foreground">
            {locked
              ? sp.subtitleClosed
              : cutoff
                ? interp(sp.subtitleOpen, { date: `${formatDay(cutoff)} ${cutoff.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}` })
                : sp.subtitleAlways}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {showWinner && (
          <BetRow
            label={sp.winner}
            points={settings.points_winner}
            currentPoints={winnerBet?.points ?? 0}
            resolved={!!winnerBet?.team_id}
          >
            <Select
              value={winner}
              onValueChange={setWinner}
              disabled={locked || saving}
            >
              <SelectTrigger className="flex-1 h-10 min-w-0">
                <SelectValue placeholder={sp.chooseTeam} />
              </SelectTrigger>
              <SelectContent>
                {teams?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="inline-flex items-center gap-2">
                      <TeamBadge
                        name={t.name}
                        shortName={t.short_name}
                        crestUrl={teamCrestUrl(t)}
                        size="sm"
                      />
                      <span>{t.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="shrink-0"
              disabled={locked || saving || !winner || winner === winnerBet?.team_id}
              onClick={() => {
                const team = teams?.find((x) => x.id === winner);
                saveBet("winner", team?.name ?? winner, winner);
              }}
            >
              {t.common.save}
            </Button>
          </BetRow>
        )}

        {showSupport && (
          <BetRow
            label={sp.supportTeam}
            points={settings.points_support_advance}
            currentPoints={supportBet?.points ?? 0}
            resolved={!!supportBet?.team_id}
            hint={interp(
              settings.support_team_mode === "champion"
                ? sp.supportTeamHintChampion
                : sp.supportTeamHint,
              { x: settings.points_support_advance },
            )}
          >
            <Select
              value={supportTeam}
              onValueChange={setSupportTeam}
              disabled={locked || saving}
            >
              <SelectTrigger className="flex-1 h-10 min-w-0">
                <SelectValue placeholder={sp.chooseTeam} />
              </SelectTrigger>
              <SelectContent>
                {teams?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="inline-flex items-center gap-2">
                      <TeamBadge
                        name={t.name}
                        shortName={t.short_name}
                        crestUrl={teamCrestUrl(t)}
                        size="sm"
                      />
                      <span>{t.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="shrink-0"
              disabled={locked || saving || !supportTeam || supportTeam === supportBet?.team_id}
              onClick={() => {
                const team = teams?.find((x) => x.id === supportTeam);
                saveBet("support_team", team?.name ?? supportTeam, supportTeam);
              }}
            >
              {t.common.save}
            </Button>
          </BetRow>
        )}

        {settings.special_bet_top_scorer_enabled && (
          <BetRow
            label={sp.topScorer}
            points={topScorerPoints}
            currentPoints={topBet?.points ?? 0}
            resolved={!!topBet?.value}
            hint={
              settings.top_scorer_mode === "per_goal"
                ? interp(sp.topScorerPerGoalHint, { x: settings.points_top_scorer_per_goal })
                : undefined
            }
          >
            <div className="flex-1 min-w-0 flex items-center gap-2 rounded-md border px-3 h-10 text-sm bg-background">
              {topScorer ? (
                <span className="truncate font-medium">{topScorer}</span>
              ) : (
                <span className="text-muted-foreground truncate">{sp.choosePlayer}</span>
              )}
            </div>
            <Button
              size="sm"
              className="shrink-0"
              disabled={locked || saving}
              variant={topScorer ? "outline" : "default"}
              onClick={() => setPickerOpen(true)}
            >
              {topScorer ? sp.changePlayer : sp.choosePlayerBtn}
            </Button>
            <TopScorerPickerDialog
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              competitionId={competitionId}
              teams={(teams ?? [])
                .filter((t): t is typeof t & { id: string } => !!t.id)
                .map((t) => ({
                  id: t.id,
                  name: t.name,
                  short_name: t.short_name,
                  crest_url: t.crest_url,
                  crest_override_url: t.crest_override_url,
                }))}
              labels={{
                title: sp.pickerTitle,
                teams: sp.pickerTeams,
                players: sp.pickerPlayers,
                pickTeam: sp.pickerPickTeam,
                confirm: sp.pickerConfirm,
                back: sp.pickerBack,
                emptySquad: sp.pickerEmptySquad,
              }}
              onConfirm={(pick) => {
                setTopScorer(pick.name);
                void saveBet("top_scorer", pick.name, null, pick.externalId);
              }}
            />
          </BetRow>
        )}

        {settings.special_bet_best_defense_enabled && (
          <BetRow
            label={sp.bestDefense}
            points={settings.points_best_defense}
            currentPoints={defBet?.points ?? 0}
            resolved={!!defBet?.team_id}
          >
            <Select
              value={bestDef}
              onValueChange={setBestDef}
              disabled={locked || saving}
            >
              <SelectTrigger className="flex-1 h-10 min-w-0">
                <SelectValue placeholder={sp.chooseTeam} />
              </SelectTrigger>
              <SelectContent>
                {teams?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="inline-flex items-center gap-2">
                      <TeamBadge
                        name={t.name}
                        shortName={t.short_name}
                        crestUrl={teamCrestUrl(t)}
                        size="sm"
                      />
                      <span>{t.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="shrink-0"
              disabled={locked || saving || !bestDef || bestDef === defBet?.team_id}
              onClick={() => {
                const team = teams?.find((x) => x.id === bestDef);
                saveBet("best_defense", team?.name ?? bestDef, bestDef);
              }}
            >
              {t.common.save}
            </Button>
          </BetRow>
        )}
      </div>
    </Card>
  );
}

function BetRow({
  label,
  points,
  currentPoints,
  resolved,
  hint,
  children,
}: {
  label: string;
  points: number;
  currentPoints: number;
  resolved: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{label}</p>
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
          {t.special.worth} {points} {t.common.points}
          {resolved && currentPoints > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-success/15 text-success">
              +{currentPoints}
            </span>
          )}
        </span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
