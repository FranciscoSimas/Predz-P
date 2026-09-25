import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StandingsView, type StandingsMatch } from "@/components/StandingsView";
import { Trophy } from "lucide-react";
import { useT } from "@/lib/i18n";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/_authenticated/t/$id/standings")({
  component: StandingsPage,
});

function StandingsPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/standings" });
  const { t } = useT();

  const { data: tournament } = useQuery({
    queryKey: ["tournament-comp-full", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "competition_id, competition:competitions(format, name, season, logo_url)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const format = tournament?.competition?.format;
  const isLeague =
    format === "league" || format === "league_phase_then_knockout";

  const { data: matches, isLoading } = useQuery({
    queryKey: ["matches-full", tournament?.competition_id],
    enabled: !!tournament?.competition_id && isLeague,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, round_or_matchday, kickoff_at, status, home_score, away_score, home_team:home_team_id(id, name, short_name, crest_url, crest_override_url), away_team:away_team_id(id, name, short_name, crest_url, crest_override_url)",
        )
        .eq("competition_id", tournament!.competition_id)
        .order("kickoff_at");
      if (error) throw error;
      return data as unknown as StandingsMatch[];
    },
  });

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-5 h-5 text-primary" />
          <h1 className="text-xl sm:text-2xl font-display tracking-wide">
            {t.matches.titleStandings}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{t.matches.subtitleStandings}</p>
      </div>

      {!isLeague && tournament ? (
        <EmptyState
          icon={<Trophy className="w-7 h-7" />}
          title={t.matches.standings.teamsEmpty}
          description={t.matches.standingsNotApplicable}
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <StandingsView
          matches={matches ?? []}
          competitionId={tournament?.competition_id ?? ""}
          competitionName={tournament?.competition?.name ?? ""}
          competitionSeason={tournament?.competition?.season ?? ""}
          competitionLogo={tournament?.competition?.logo_url ?? null}
        />
      )}
    </div>
  );
}
