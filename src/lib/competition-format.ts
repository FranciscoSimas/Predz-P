/** Pure league table competitions (winner special bet). */
export function isLeagueFormat(format: string | null | undefined): boolean {
  return format === "league";
}

/** Formats with a knockout / finals phase (support-team special bet). */
export function isKnockoutishFormat(format: string | null | undefined): boolean {
  return (
    format === "league_phase_then_knockout" ||
    format === "groups_then_knockout" ||
    format === "groups_then_finals" ||
    format === "knockout_only"
  );
}

/** Soft-launch: calendar empty until play-offs / league phase is ready. */
const CALENDAR_PENDING_SLUGS = new Set([
  "champions-league-26-27",
  "europa-league-26-27",
]);

export function isCalendarPendingCompetition(slug: string | null | undefined): boolean {
  return !!slug && CALENDAR_PENDING_SLUGS.has(slug);
}
