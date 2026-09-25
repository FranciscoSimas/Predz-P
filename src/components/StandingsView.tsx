import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { TeamBadge } from "@/components/TeamBadge";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trophy } from "lucide-react";
import { useT } from "@/lib/i18n";
import { teamCrestUrl } from "@/lib/team-crest";
import {
  ZONE_COLORS,
  computeForm,
  zoneForPosition,
  zoneLabel,
  type FormEntry,
  type FormResult,
  type StandingZone,
} from "@/lib/standing-zones";

export type StandingsTeam = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  crest_override_url?: string | null;
};

export type StandingsMatch = {
  id: string;
  round_or_matchday: number | null;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team: StandingsTeam | null;
  away_team: StandingsTeam | null;
};

type Row = {
  team: StandingsTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: FormEntry[];
};

function FormDots({ form }: { form: FormEntry[] }) {
  const { t } = useT();
  const s = t.matches.standings;
  const color: Record<FormResult, string> = {
    W: "bg-emerald-600 text-white",
    D: "bg-muted-foreground/35 text-foreground",
    L: "bg-destructive text-destructive-foreground",
  };
  // Exactly 5 recent results (most recent first).
  return (
    <div className="inline-flex items-center gap-px sm:gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const entry = form[i];
        if (!entry) {
          return (
            <span
              key={i}
              className="w-3 h-3 sm:w-4 sm:h-4 rounded-[2px] text-[8px] sm:text-[9px] font-bold grid place-items-center leading-none bg-muted text-muted-foreground/30"
            />
          );
        }
        const opp = entry.opponentName;
        const venue = entry.isHome ? s.formHome : s.formAway;
        const tip = s.formTooltip
          .replace("{opp}", opp)
          .replace("{score}", `${entry.homeScore}–${entry.awayScore}`)
          .replace("{venue}", venue);
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span
                className={`w-3 h-3 sm:w-4 sm:h-4 rounded-[2px] text-[8px] sm:text-[9px] font-bold grid place-items-center leading-none cursor-help ${color[entry.result]}`}
                aria-label={tip}
              >
                {entry.result}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs font-medium">
              {tip}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function StandingsView({
  matches,
  competitionId,
  competitionName,
  competitionSeason,
  competitionLogo,
}: {
  matches: StandingsMatch[];
  competitionId: string;
  competitionName: string;
  competitionSeason: string;
  competitionLogo: string | null;
}) {
  const { t, locale } = useT();
  const s = t.matches.standings;

  const { data: allTeams, isLoading: teamsLoading } = useQuery({
    queryKey: ["comp-teams-standings", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_teams")
        .select("id, name, short_name, crest_url, crest_override_url")
        .eq("competition_id", competitionId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as StandingsTeam[];
    },
  });

  const { data: zones = [] } = useQuery({
    queryKey: ["standing-zones", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_standing_zones")
        .select(
          "id, competition_id, position_from, position_to, zone_key, label_pt, label_en, sort_order",
        )
        .eq("competition_id", competitionId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as StandingZone[];
    },
  });

  const rows = useMemo(() => {
    const map = new Map<string, Omit<Row, "gd" | "pts" | "form">>();
    for (const team of allTeams ?? []) {
      map.set(team.id, {
        team,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
      });
    }
    const ensure = (team: StandingsTeam | null) => {
      if (!team) return null;
      if (!map.has(team.id)) {
        map.set(team.id, {
          team,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          gf: 0,
          ga: 0,
        });
      }
      return map.get(team.id)!;
    };
    for (const m of matches) {
      if (m.status !== "finished" || m.home_score == null || m.away_score == null) continue;
      const h = ensure(m.home_team);
      const a = ensure(m.away_team);
      if (!h || !a) continue;
      h.played++;
      a.played++;
      h.gf += m.home_score;
      h.ga += m.away_score;
      a.gf += m.away_score;
      a.ga += m.home_score;
      if (m.home_score > m.away_score) {
        h.wins++;
        a.losses++;
      } else if (m.home_score < m.away_score) {
        a.wins++;
        h.losses++;
      } else {
        h.draws++;
        a.draws++;
      }
    }
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        gd: r.gf - r.ga,
        pts: r.wins * 3 + r.draws,
        form: computeForm(matches, r.team.id),
      }))
      .sort(
        (x, y) =>
          y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name),
      );
  }, [matches, allTeams]);

  const legendZones = useMemo(() => {
    const seen = new Set<string>();
    return zones.filter((z) => {
      if (seen.has(z.zone_key)) return false;
      seen.add(z.zone_key);
      return true;
    });
  }, [zones]);

  if (teamsLoading && rows.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Trophy className="w-7 h-7" />}
        title={s.teamsEmpty}
        description={s.teamsEmptyDesc}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3 min-w-0">
        <Card className="p-3 sm:p-4 shadow-card">
          <div className="flex items-center gap-3 min-w-0">
            <CompetitionBadge
              name={competitionName}
              logoUrl={competitionLogo}
              size="lg"
            />
            <div className="min-w-0">
              <p className="font-bold truncate text-base sm:text-lg">{competitionName}</p>
              <p className="text-sm text-muted-foreground">
                {s.seasonPrefix} {competitionSeason}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden shadow-card min-w-0">
          <div className="w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
            <table className="w-full text-[11px] sm:text-sm border-collapse">
              <thead className="bg-muted/50 text-[9px] sm:text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted/95 text-left font-semibold px-1.5 sm:px-3 py-1.5 sm:py-2 w-6 sm:w-8">
                    {s.pos}
                  </th>
                  <th className="sticky left-6 sm:left-8 z-20 bg-muted/95 text-left font-semibold px-1.5 sm:px-3 py-1.5 sm:py-2 w-[8.5rem] sm:min-w-[11rem]">
                    {s.team}
                  </th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-6">{s.played}</th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-6">{s.wins}</th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-6">{s.draws}</th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-6">{s.losses}</th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-8">{s.gd}</th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-10 sm:w-14">
                    <span className="sm:hidden">{s.goalsShort}</span>
                    <span className="hidden sm:inline">{s.goals}</span>
                  </th>
                  <th className="text-center font-semibold px-1 py-1.5 sm:px-1.5 sm:py-2 w-[4.25rem] sm:w-[5.5rem]">
                    <span className="sm:hidden">{s.formShort}</span>
                    <span className="hidden sm:inline">{s.form}</span>
                  </th>
                  <th className="text-center font-semibold px-1.5 sm:px-2 py-1.5 sm:py-2 w-8 text-primary">
                    {s.pts}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const pos = i + 1;
                  const zone = zoneForPosition(zones, pos);
                  const color = zone ? ZONE_COLORS[zone.zone_key] : undefined;
                  const label = zone ? zoneLabel(zone, locale) : undefined;
                  return (
                    <tr key={r.team.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td
                        className="sticky left-0 z-10 bg-card px-1.5 sm:px-3 py-1.5 sm:py-2 text-muted-foreground tabular font-semibold text-[11px] sm:text-sm"
                        style={
                          color
                            ? { boxShadow: `inset 3px 0 0 0 ${color}` }
                            : undefined
                        }
                      >
                        {label ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help" title={label}>
                                {pos}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right">{label}</TooltipContent>
                          </Tooltip>
                        ) : (
                          pos
                        )}
                      </td>
                      <td className="sticky left-6 sm:left-8 z-10 bg-card px-1.5 sm:px-3 py-1.5 sm:py-2">
                        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 max-w-[8.5rem] sm:max-w-none">
                          <TeamBadge
                            name={r.team.name}
                            shortName={r.team.short_name}
                            crestUrl={teamCrestUrl(r.team)}
                            size="md"
                            className="!w-7 !h-7 sm:!w-8 sm:!h-8 [&_img]:!w-5 [&_img]:!h-5 sm:[&_img]:!w-6 sm:[&_img]:!h-6"
                          />
                          <span className="font-medium truncate text-[11px] sm:text-sm">
                            <span className="sm:hidden">
                              {r.team.short_name || r.team.name}
                            </span>
                            <span className="hidden sm:inline">{r.team.name}</span>
                          </span>
                        </div>
                      </td>
                      <td className="text-center px-1 py-1.5 tabular">{r.played}</td>
                      <td className="text-center px-1 py-1.5 tabular">{r.wins}</td>
                      <td className="text-center px-1 py-1.5 tabular">{r.draws}</td>
                      <td className="text-center px-1 py-1.5 tabular">{r.losses}</td>
                      <td className="text-center px-1 py-1.5 tabular">
                        {r.gd > 0 ? `+${r.gd}` : r.gd}
                      </td>
                      <td className="text-center px-1 py-1.5 tabular whitespace-nowrap">
                        {r.gf}:{r.ga}
                      </td>
                      <td className="text-center px-1 py-1.5">
                        <FormDots form={r.form} />
                      </td>
                      <td className="text-center px-1.5 sm:px-2 py-1.5 tabular font-bold text-primary">
                        {r.pts}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {legendZones.length > 0 && (
          <div className="space-y-2 px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {s.legend}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {legendZones.map((z) => (
                <li key={z.id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: ZONE_COLORS[z.zone_key] ?? "#888" }}
                  />
                  {zoneLabel(z, locale)}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">{s.zonesNote}</p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
