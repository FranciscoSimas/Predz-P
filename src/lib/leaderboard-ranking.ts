/** Sort by points, then tiebreak: correct → exact → [support] → [scorer goals]. */

export type LeaderboardTiebreakRow = {
  total_points: number;
  correct_count: number;
  exact_count: number;
  support_advances?: number | null;
  top_scorer_goals?: number | null;
};

export type LeaderboardRankOptions = {
  /** Only when support-team special bet is active. */
  useSupportAdvances?: boolean;
  /** Only when top-scorer is active in per-goal mode. */
  useTopScorerGoals?: boolean;
};

export function formatPoints(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "0";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function compareLeaderboardRows(
  a: LeaderboardTiebreakRow,
  b: LeaderboardTiebreakRow,
  opts: LeaderboardRankOptions = {},
): number {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  if (b.correct_count !== a.correct_count) return b.correct_count - a.correct_count;
  if (b.exact_count !== a.exact_count) return b.exact_count - a.exact_count;
  if (opts.useSupportAdvances) {
    const sa = a.support_advances ?? 0;
    const sb = b.support_advances ?? 0;
    if (sb !== sa) return sb - sa;
  }
  if (opts.useTopScorerGoals) {
    const ga = a.top_scorer_goals ?? 0;
    const gb = b.top_scorer_goals ?? 0;
    if (gb !== ga) return gb - ga;
  }
  return 0;
}

export function sortLeaderboard<T extends LeaderboardTiebreakRow>(
  rows: T[],
  opts: LeaderboardRankOptions = {},
): T[] {
  return [...rows].sort((a, b) => compareLeaderboardRows(a, b, opts));
}

/** Dense ranking: 1, 2, 2, 3 when fully tied on all active criteria. */
export function withCompetitionRanks<T extends LeaderboardTiebreakRow>(
  rows: T[],
  opts: LeaderboardRankOptions = {},
): (T & { rank: number })[] {
  const sorted = sortLeaderboard(rows, opts);
  const out: (T & { rank: number })[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (i === 0) {
      out.push({ ...row, rank: 1 });
      continue;
    }
    const prev = out[i - 1]!;
    const rank = compareLeaderboardRows(row, prev, opts) === 0 ? prev.rank : prev.rank + 1;
    out.push({ ...row, rank });
  }
  return out;
}

export function rankOptionsFromSettings(s: {
  special_bets_enabled?: boolean | null;
  special_bet_support_team_enabled?: boolean | null;
  special_bet_top_scorer_enabled?: boolean | null;
  top_scorer_mode?: string | null;
} | null | undefined): LeaderboardRankOptions {
  const special = !!s?.special_bets_enabled;
  return {
    useSupportAdvances: special && !!s?.special_bet_support_team_enabled,
    useTopScorerGoals:
      special && !!s?.special_bet_top_scorer_enabled && s?.top_scorer_mode === "per_goal",
  };
}
