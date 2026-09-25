import { describe, expect, it } from "vitest";
import {
  aggregateFromPerspective,
  canOpenEt,
  canOpenPens,
  liveFirstLegScores,
  resolveAdvancingTeamId,
} from "./knockout-aggregate";

describe("knockout-aggregate", () => {
  const first = { homeTeamId: "A", awayTeamId: "B" };
  const second = { homeTeamId: "B", awayTeamId: "A" };

  it("aggregates swapped home/away correctly", () => {
    const agg = aggregateFromPerspective(
      { ...first, home: 2, away: 1 },
      { ...second, home: 1, away: 2 },
      "second",
    );
    // B=1+1=2, A=2+2=4 from second perspective
    expect(agg).toEqual({ home: 2, away: 4 });
  });

  it("opens ET on second when live aggregate is tied", () => {
    expect(
      canOpenEt({
        legKind: "second",
        home90: 1,
        away90: 2,
        firstLeg: {
          ...first,
          finished: true,
          homeScore: 2,
          awayScore: 1,
          homePred: null,
          awayPred: null,
        },
        second,
      }),
    ).toBe(true);
  });

  it("closes ET when first leg result breaks the tie", () => {
    expect(
      canOpenEt({
        legKind: "second",
        home90: 1,
        away90: 2,
        firstLeg: {
          ...first,
          finished: true,
          homeScore: 2,
          awayScore: 0,
          homePred: 2,
          awayPred: 1,
        },
        second,
      }),
    ).toBe(false);
  });

  it("uses first-leg prediction before kickoff", () => {
    const live = liveFirstLegScores({
      firstFinished: false,
      firstHomeScore: null,
      firstAwayScore: null,
      firstHomePred: 2,
      firstAwayPred: 1,
    });
    expect(live).toEqual({ home: 2, away: 1 });
  });

  it("opens pens only on ET draw", () => {
    expect(canOpenPens(2, 2)).toBe(true);
    expect(canOpenPens(3, 2)).toBe(false);
  });

  it("resolves two-leg advancement via pens when aggregate stays tied", () => {
    const winner = resolveAdvancingTeamId({
      legKind: "second",
      homeTeamId: "B",
      awayTeamId: "A",
      home90: 2,
      away90: 1,
      etHome: 2,
      etAway: 1,
      penHome: 5,
      penAway: 4,
      firstLeg: { homeTeamId: "A", awayTeamId: "B", home: 2, away: 1 },
    });
    // first A2 B1 + second B2 A1 => A3 B3; 120' still B2 A1 => A3 B3; pens B
    expect(winner).toBe("B");
  });

  it("resolves single-leg via ET", () => {
    expect(
      resolveAdvancingTeamId({
        legKind: "single",
        homeTeamId: "H",
        awayTeamId: "A",
        home90: 1,
        away90: 1,
        etHome: 2,
        etAway: 1,
      }),
    ).toBe("H");
  });
});
