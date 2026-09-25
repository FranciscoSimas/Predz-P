/**
 * Per-match win-streak bonus, mirroring public.recalc_tournament_streaks:
 * after N consecutive correct (points > 0), each further correct earns `bonusPer`.
 */
export function streakBonusByMatchId(
  finishedOrdered: { id: string }[],
  pointsByMatchId: ReadonlyMap<string, number | null | undefined>,
  threshold: number,
  bonusPer: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (threshold <= 0 || bonusPer <= 0) return out;

  let cur = 0;
  for (const m of finishedOrdered) {
    const pts = pointsByMatchId.get(m.id);
    const hasPred = pts != null;
    if (!hasPred || pts <= 0) {
      cur = 0;
      continue;
    }
    cur += 1;
    if (cur > threshold) {
      out.set(m.id, bonusPer);
    }
  }
  return out;
}
