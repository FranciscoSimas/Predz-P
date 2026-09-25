/** Knockout two-leg aggregate + ET/PEN gate helpers (pure). */

export type LegKind = "single" | "first" | "second" | "replay" | "final_single";

export type ScorePair = { home: number; away: number };

export type MatchSide = {
  homeTeamId: string;
  awayTeamId: string;
  home: number | null;
  away: number | null;
};

export function isDecisiveLeg(legKind: LegKind | null | undefined): boolean {
  return (
    legKind === "second" ||
    legKind === "single" ||
    legKind === "final_single" ||
    legKind === "replay"
  );
}

export function allowsEtPen(legKind: LegKind | null | undefined): boolean {
  return legKind != null && legKind !== "first";
}

/** Mirror of private.effective_leg_kind when DB column is still null. */
export function effectiveLegKind(
  legKind: string | null | undefined,
  phase: string | null | undefined,
  isKnockoutComp: boolean,
): LegKind | null {
  if (
    legKind === "single" ||
    legKind === "first" ||
    legKind === "second" ||
    legKind === "replay" ||
    legKind === "final_single"
  ) {
    return legKind;
  }
  if (!isKnockoutComp) return null;
  const p = (phase ?? "").toLowerCase();
  if (p.includes("league") || p === "regular" || p.includes("group")) return null;
  if (p.includes("final") && !p.includes("semi") && !p.includes("quarter")) {
    return "final_single";
  }
  if (
    p.includes("knock") ||
    p.includes("final") ||
    p.includes("play") ||
    p.includes("round_of") ||
    p.includes("last_16") ||
    p.includes("quarter") ||
    p.includes("semi")
  ) {
    return "single";
  }
  return null;
}

/** Sum goals by team id across two legs; return pair from the perspective of `perspective`. */
export function aggregateFromPerspective(
  first: MatchSide,
  second: MatchSide,
  perspective: "second" | "first" = "second",
): ScorePair | null {
  if (
    first.home == null ||
    first.away == null ||
    second.home == null ||
    second.away == null
  ) {
    return null;
  }
  const goals = new Map<string, number>();
  const add = (teamId: string, n: number) => {
    goals.set(teamId, (goals.get(teamId) ?? 0) + n);
  };
  add(first.homeTeamId, first.home);
  add(first.awayTeamId, first.away);
  add(second.homeTeamId, second.home);
  add(second.awayTeamId, second.away);

  const view = perspective === "second" ? second : first;
  const home = goals.get(view.homeTeamId);
  const away = goals.get(view.awayTeamId);
  if (home == null || away == null) return null;
  return { home, away };
}

/** Live first-leg scores for aggregate: real if finished, else user prediction. */
export function liveFirstLegScores(args: {
  firstFinished: boolean;
  firstHomeScore: number | null;
  firstAwayScore: number | null;
  firstHomePred: number | null;
  firstAwayPred: number | null;
}): ScorePair | null {
  if (args.firstFinished) {
    if (args.firstHomeScore == null || args.firstAwayScore == null) return null;
    return { home: args.firstHomeScore, away: args.firstAwayScore };
  }
  if (args.firstHomePred == null || args.firstAwayPred == null) return null;
  return { home: args.firstHomePred, away: args.firstAwayPred };
}

export function canOpenEtSingle(home90: number | null, away90: number | null): boolean {
  return home90 != null && away90 != null && home90 === away90;
}

export function canOpenPens(etHome: number | null, etAway: number | null): boolean {
  return etHome != null && etAway != null && etHome === etAway;
}

/**
 * Gate for opening ET on a match card.
 * - first: never
 * - single / final_single / replay: 90' draw
 * - second: aggregate (first live + second 90') tied
 */
export function canOpenEt(args: {
  legKind: LegKind | null | undefined;
  home90: number | null;
  away90: number | null;
  firstLeg?: {
    homeTeamId: string;
    awayTeamId: string;
    finished: boolean;
    homeScore: number | null;
    awayScore: number | null;
    homePred: number | null;
    awayPred: number | null;
  } | null;
  second?: {
    homeTeamId: string;
    awayTeamId: string;
  } | null;
}): boolean {
  const { legKind } = args;
  if (legKind == null || legKind === "first") return false;
  if (legKind === "single" || legKind === "final_single" || legKind === "replay") {
    return canOpenEtSingle(args.home90, args.away90);
  }
  if (legKind !== "second" || !args.firstLeg || !args.second) return false;
  if (args.home90 == null || args.away90 == null) return false;

  const firstScores = liveFirstLegScores({
    firstFinished: args.firstLeg.finished,
    firstHomeScore: args.firstLeg.homeScore,
    firstAwayScore: args.firstLeg.awayScore,
    firstHomePred: args.firstLeg.homePred,
    firstAwayPred: args.firstLeg.awayPred,
  });
  if (!firstScores) return false;

  const agg = aggregateFromPerspective(
    {
      homeTeamId: args.firstLeg.homeTeamId,
      awayTeamId: args.firstLeg.awayTeamId,
      home: firstScores.home,
      away: firstScores.away,
    },
    {
      homeTeamId: args.second.homeTeamId,
      awayTeamId: args.second.awayTeamId,
      home: args.home90,
      away: args.away90,
    },
    "second",
  );
  return !!agg && agg.home === agg.away;
}

/**
 * Resolve who advances for a decisive match from scorelines.
 * Returns team id or null if unresolved.
 */
export function resolveAdvancingTeamId(args: {
  legKind: LegKind;
  homeTeamId: string;
  awayTeamId: string;
  home90: number;
  away90: number;
  etHome?: number | null;
  etAway?: number | null;
  penHome?: number | null;
  penAway?: number | null;
  firstLeg?: {
    homeTeamId: string;
    awayTeamId: string;
    home: number;
    away: number;
  } | null;
}): string | null {
  if (args.legKind === "first") return null;

  if (args.legKind === "second" && args.firstLeg) {
    const agg90 = aggregateFromPerspective(
      {
        homeTeamId: args.firstLeg.homeTeamId,
        awayTeamId: args.firstLeg.awayTeamId,
        home: args.firstLeg.home,
        away: args.firstLeg.away,
      },
      {
        homeTeamId: args.homeTeamId,
        awayTeamId: args.awayTeamId,
        home: args.home90,
        away: args.away90,
      },
      "second",
    );
    if (!agg90) return null;
    if (agg90.home !== agg90.away) {
      return agg90.home > agg90.away ? args.homeTeamId : args.awayTeamId;
    }
    if (args.etHome == null || args.etAway == null) return null;
    const agg120 = aggregateFromPerspective(
      {
        homeTeamId: args.firstLeg.homeTeamId,
        awayTeamId: args.firstLeg.awayTeamId,
        home: args.firstLeg.home,
        away: args.firstLeg.away,
      },
      {
        homeTeamId: args.homeTeamId,
        awayTeamId: args.awayTeamId,
        home: args.etHome,
        away: args.etAway,
      },
      "second",
    );
    if (!agg120) return null;
    if (agg120.home !== agg120.away) {
      return agg120.home > agg120.away ? args.homeTeamId : args.awayTeamId;
    }
    if (args.penHome == null || args.penAway == null || args.penHome === args.penAway) {
      return null;
    }
    return args.penHome > args.penAway ? args.homeTeamId : args.awayTeamId;
  }

  if (args.home90 !== args.away90) {
    return args.home90 > args.away90 ? args.homeTeamId : args.awayTeamId;
  }
  if (args.etHome == null || args.etAway == null) return null;
  if (args.etHome !== args.etAway) {
    return args.etHome > args.etAway ? args.homeTeamId : args.awayTeamId;
  }
  if (args.penHome == null || args.penAway == null || args.penHome === args.penAway) {
    return null;
  }
  return args.penHome > args.penAway ? args.homeTeamId : args.awayTeamId;
}

/** Human labels for knockout phases (PT). */
export function phaseRoundLabelPt(phase: string | null | undefined, round: number | null): string {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("league") || p === "regular" || p.includes("group")) {
    return round != null ? `Jornada ${round}` : "Jornada";
  }
  if (p.includes("playoff") || p.includes("play-off") || p.includes("play_off")) return "Play-off";
  if (p.includes("round_of_32") || p.includes("32")) return "16-avos";
  if (p.includes("round_of_16") || p.includes("last_16") || p.includes("oitavos")) return "Oitavos";
  if (p.includes("quarter")) return "Quartos";
  if (p.includes("semi")) return "Meias";
  if (p.includes("third")) return "3.º lugar";
  if (p.includes("final")) return "Final";
  if (round != null) return `Jornada ${round}`;
  return phase ?? "Fase";
}

export function phaseRoundLabelEn(phase: string | null | undefined, round: number | null): string {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("league") || p === "regular" || p.includes("group")) {
    return round != null ? `Matchday ${round}` : "Matchday";
  }
  if (p.includes("playoff") || p.includes("play-off") || p.includes("play_off")) return "Play-off";
  if (p.includes("round_of_32") || p.includes("32")) return "Round of 32";
  if (p.includes("round_of_16") || p.includes("last_16")) return "Round of 16";
  if (p.includes("quarter")) return "Quarter-finals";
  if (p.includes("semi")) return "Semi-finals";
  if (p.includes("third")) return "3rd place";
  if (p.includes("final")) return "Final";
  if (round != null) return `Matchday ${round}`;
  return phase ?? "Round";
}
