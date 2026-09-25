import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { LiveIndicator } from "@/components/LiveIndicator";
import { isMatchDisplayLive } from "@/components/MatchScoreCompare";
import { TeamBadge } from "@/components/TeamBadge";
import { PrizesCard, type PrizesCardData } from "@/components/PrizesCard";
import {
  Trophy,
  ListChecks,
  Users,
  CalendarDays,
  Target,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { teamCrestUrl } from "@/lib/team-crest";
import { formatPoints, rankOptionsFromSettings, withCompetitionRanks } from "@/lib/leaderboard-ranking";

export const Route = createFileRoute("/_authenticated/t/$id/")({
  component: Dashboard,
});

type LB = {
  user_id: string;
  display_name: string | null;
  avatar_url?: string | null;
  total_points: number;
  correct_count: number;
  exact_count: number;
  predictions_made?: number;
  withdrawn_at?: string | null;
  support_advances?: number | null;
  top_scorer_goals?: number | null;
  rank?: number;
};

function Dashboard() {
  const { id } = useParams({ from: "/_authenticated/t/$id/" });
  const { t, formatMatchTime } = useT();
  const d = t.tournament.dashboard;

  const { data: leaderboard } = useQuery({
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
      return withCompetitionRanks((lbRes.data ?? []) as LB[], rankOptionsFromSettings(setRes.data));
    },
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: tournament } = useQuery({
    queryKey: ["tournament-comp", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("competition_id, competition:competitions(format)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as {
        competition_id: string;
        competition: { format: string } | null;
      };
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

  const { data: upcoming } = useQuery({
    queryKey: ["upcoming", tournament?.competition_id],
    enabled: !!tournament?.competition_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, kickoff_at, status, home_score, away_score, home_team:home_team_id(name, short_name, crest_url, crest_override_url), away_team:away_team_id(name, short_name, crest_url, crest_override_url)",
        )
        .eq("competition_id", tournament!.competition_id)
        .gte("kickoff_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
        .order("kickoff_at")
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent", tournament?.competition_id],
    enabled: !!tournament?.competition_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, kickoff_at, status, home_score, away_score, home_team:home_team_id(name, short_name, crest_url, crest_override_url), away_team:away_team_id(name, short_name, crest_url, crest_override_url)",
        )
        .eq("competition_id", tournament!.competition_id)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  const myRow = leaderboard?.find((r) => r.user_id === me?.id);
  const myRank = myRow?.rank ?? null;
  const podium = (leaderboard ?? []).slice(0, 3);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* My position hero */}
      <Card className="p-5 sm:p-6 shadow-card overflow-hidden relative border-primary/25">
        <div className="absolute inset-0 gradient-hero-soft pointer-events-none" />
        <div className="absolute -right-8 -top-10 size-36 rounded-full bg-primary/15 blur-2xl pointer-events-none dark:bg-primary/25" />
        <div className="relative">
          <p className="text-xs uppercase tracking-widest text-primary font-semibold">
            {d.myPosition}
          </p>
          <div className="flex items-end gap-3 mt-1">
            <span className="text-5xl sm:text-6xl font-extrabold tabular text-foreground">
              {myRank ? `#${myRank}` : "-"}
            </span>
            <span className="text-muted-foreground pb-2 text-sm">
              {d.of} {leaderboard?.length ?? 0} {d.players}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-5">
            <Stat label={d.statPoints} value={formatPoints(myRow?.total_points ?? 0)} highlight />
            <Stat label={d.statPredictions} value={myRow?.predictions_made ?? 0} />
            <Stat label={d.statCorrect} value={myRow?.correct_count ?? 0} />
            <Stat label={d.statExact} value={myRow?.exact_count ?? 0} />
          </div>
          <Button asChild size="sm" variant="secondary" className="mt-5">
            <Link to="/t/$id/ranking" params={{ id }}>
              {d.viewFullRanking} <Trophy className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </Card>

      <PrizesCard data={prizes} memberCount={leaderboard?.length ?? 1} />

      {/* Upcoming */}
      <Section
        title={d.upcoming}
        icon={<CalendarDays className="w-4 h-4" />}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to="/t/$id/matches" params={{ id }}>
              {d.viewAll}
            </Link>
          </Button>
        }
      >
        {!upcoming ? (
          <SkeletonRows n={3} />
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="w-6 h-6" />}
            title={d.noScheduled}
            description={d.noScheduledDesc}
          />
        ) : (
          <div className="space-y-2">
            {upcoming.map((m: any) => (
              <MatchRow key={m.id} m={m} fmtTime={formatMatchTime} finishedLabel={d.finished} />
            ))}
            <Button asChild variant="secondary" className="w-full mt-1">
              <Link to="/t/$id/predictions" params={{ id }}>
                <ListChecks className="w-4 h-4 mr-1.5" /> {d.makePredictions}
              </Link>
            </Button>
          </div>
        )}
      </Section>

      {/* Podium */}
      <Section title={d.podium} icon={<Trophy className="w-4 h-4" />}>
        {!leaderboard ? (
          <SkeletonRows n={1} />
        ) : podium.length < 1 ? (
          <EmptyState
            icon={<Users className="w-6 h-6" />}
            title={d.noScore}
            description={d.noScoreDesc}
          />
        ) : (
          <Podium rows={podium} playerFallback={d.player} />
        )}
      </Section>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard icon={<Sparkles className="w-4 h-4" />} label={d.statPoints} value={formatPoints(myRow?.total_points ?? 0)} />
        <StatCard icon={<Target className="w-4 h-4" />} label={d.statCorrect} value={myRow?.correct_count ?? 0} />
        <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label={d.statExact} value={myRow?.exact_count ?? 0} />
        <StatCard icon={<ListChecks className="w-4 h-4" />} label={d.statPredictions} value={myRow?.predictions_made ?? 0} />
      </div>

      {/* Recent */}
      <Section title={d.recent} icon={<CalendarDays className="w-4 h-4" />}>
        {!recent ? (
          <SkeletonRows n={2} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="w-6 h-6" />}
            title={d.noFinished}
            description={d.noFinishedDesc}
          />
        ) : (
          <div className="space-y-2">
            {recent.map((m: any) => (
              <MatchRow key={m.id} m={m} finished fmtTime={formatMatchTime} finishedLabel={d.finished} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl px-2 py-2 text-center ${
        highlight
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-background/80 dark:bg-background/50 border border-border/60"
      }`}
    >
      <p className="text-lg sm:text-xl font-bold tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-3 shadow-card">
      <div className="text-primary">{icon}</div>
      <p className="text-xl sm:text-2xl font-bold tabular mt-1">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </Card>
  );
}

function MatchRow({
  m,
  finished,
  fmtTime,
  finishedLabel,
}: {
  m: any;
  finished?: boolean;
  fmtTime: (iso: string) => string;
  finishedLabel: string;
}) {
  const isLive = isMatchDisplayLive(m.kickoff_at, m.status, !!m.is_postponed);
  return (
    <Card className="p-3 shadow-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
        <span>{fmtTime(m.kickoff_at)}</span>
        {isLive ? (
          <LiveIndicator />
        ) : finished ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider">{finishedLabel}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 sm:gap-2">
        <div className="flex items-center justify-end gap-1.5 min-w-0">
          <p className="font-medium truncate text-right min-w-0 text-sm">
            {m.home_team?.short_name || m.home_team?.name}
          </p>
          <TeamBadge
            name={m.home_team?.name ?? ""}
            shortName={m.home_team?.short_name}
            crestUrl={teamCrestUrl(m.home_team)}
            size="md"
          />
        </div>
        <span className="font-mono font-bold tabular text-sm px-2 py-1 rounded-md bg-muted shrink-0">
          {m.home_score ?? "–"} : {m.away_score ?? "–"}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <TeamBadge
            name={m.away_team?.name ?? ""}
            shortName={m.away_team?.short_name}
            crestUrl={teamCrestUrl(m.away_team)}
            size="md"
          />
          <p className="font-medium truncate min-w-0 text-sm">
            {m.away_team?.short_name || m.away_team?.name}
          </p>
        </div>
      </div>
    </Card>
  );
}

function Podium({ rows, playerFallback }: { rows: LB[]; playerFallback: string }) {
  const [first, second, third] = [rows[0], rows[1], rows[2]];
  const item = (r: LB | undefined, place: 1 | 2 | 3) => {
    if (!r) return <div className="flex-1" />;
    const grad =
      place === 1
        ? "gradient-gold text-gold-foreground"
        : place === 2
          ? "gradient-silver text-silver-foreground"
          : "gradient-bronze text-bronze-foreground";
    const h = place === 1 ? "h-24" : place === 2 ? "h-18" : "h-14";
    const size = place === 1 ? "w-14 h-14 text-lg" : "w-11 h-11 text-sm";
    const initials = (r.display_name ?? playerFallback[0] ?? "P")
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
    const withdrew = !!r.withdrawn_at;
    return (
      <div className={`flex-1 flex flex-col items-center ${withdrew ? "opacity-90" : ""}`}>
        <span
          className={`${size} rounded-full grid place-items-center font-bold shadow-card ${
            withdrew ? "bg-destructive text-destructive-foreground" : grad
          }`}
        >
          {initials}
        </span>
        <p
          className={`mt-2 text-sm font-semibold truncate max-w-full px-1 text-center ${
            withdrew ? "text-destructive" : ""
          }`}
        >
          {r.display_name ?? playerFallback}
        </p>
        <p className={`text-xs tabular ${withdrew ? "text-destructive" : "text-muted-foreground"}`}>
          {formatPoints(r.total_points)} pts
        </p>
        <div
          className={`${h} w-full mt-2 rounded-t-xl ${
            withdrew ? "bg-destructive text-destructive-foreground" : grad
          } grid place-items-center text-2xl font-extrabold`}
        >
          {place}
        </div>
      </div>
    );
  };
  return (
    <Card className="p-4 shadow-card">
      <div className="flex items-end gap-2">
        {item(second, 2)}
        {item(first, 1)}
        {item(third, 3)}
      </div>
    </Card>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
      ))}
    </div>
  );
}
