export type StandingZone = {
  id: string;
  competition_id: string;
  position_from: number;
  position_to: number;
  zone_key: string;
  label_pt: string;
  label_en: string;
  sort_order: number;
};

/** Distinct qualification / relegation colors (2026/27 palette). */
export const ZONE_COLORS: Record<string, string> = {
  champions_league: "#3827F5",
  champions_league_qualifying: "#5C8DF7",
  europa_league: "#F07C18",
  europa_league_qualifying: "#FCA92B",
  conference_league: "#16DB4F",
  conference_league_qualifying: "#05A80A",
  libertadores: "#3827F5",
  libertadores_qualifying: "#5C8DF7",
  sudamericana: "#F07C18",
  promotion: "#3827F5",
  promotion_playoff: "#5C8DF7",
  round_of_16: "#3827F5",
  knockout_playoff: "#F07C18",
  relegation_playoff: "#F70000",
  relegation: "#A30000",
  eliminated: "#6b7280",
};

export function zoneForPosition(
  zones: StandingZone[],
  position: number,
): StandingZone | null {
  return (
    zones.find((z) => position >= z.position_from && position <= z.position_to) ??
    null
  );
}

export function zoneLabel(zone: StandingZone, locale: string): string {
  return locale.startsWith("en") ? zone.label_en : zone.label_pt;
}

export type FormResult = "W" | "D" | "L";

export type FormEntry = {
  result: FormResult;
  opponentName: string;
  opponentShort: string | null;
  /** Team goals – opponent goals (from this team's perspective). */
  goalsFor: number;
  goalsAgainst: number;
  /** Actual fixture score home–away. */
  homeScore: number;
  awayScore: number;
  isHome: boolean;
};

export function computeForm(
  matches: Array<{
    status: string;
    kickoff_at: string;
    home_score: number | null;
    away_score: number | null;
    home_team: {
      id: string;
      name?: string;
      short_name?: string | null;
    } | null;
    away_team: {
      id: string;
      name?: string;
      short_name?: string | null;
    } | null;
  }>,
  teamId: string,
  limit = 5,
): FormEntry[] {
  const finished = matches
    .filter(
      (m) =>
        m.status === "finished" &&
        m.home_score != null &&
        m.away_score != null &&
        (m.home_team?.id === teamId || m.away_team?.id === teamId),
    )
    .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
    .slice(0, limit);

  return finished
    .map((m) => {
      const isHome = m.home_team?.id === teamId;
      const opp = isHome ? m.away_team : m.home_team;
      const goalsFor = isHome ? m.home_score! : m.away_score!;
      const goalsAgainst = isHome ? m.away_score! : m.home_score!;
      const result: FormResult =
        goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
      return {
        result,
        opponentName: opp?.name ?? "-",
        opponentShort: opp?.short_name ?? null,
        goalsFor,
        goalsAgainst,
        homeScore: m.home_score!,
        awayScore: m.away_score!,
        isHome,
      };
    })
    .reverse();
}
