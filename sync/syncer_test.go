package main

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestSeasonStartYear(t *testing.T) {
	t.Parallel()
	tests := []struct {
		season string
		want   int
	}{
		{season: "25/26", want: 2025},
		{season: "2025/26", want: 2025},
		{season: "2025-2026", want: 2025},
	}
	for _, test := range tests {
		got, err := seasonStartYear(test.season)
		if err != nil {
			t.Fatalf("seasonStartYear(%q) returned error: %v", test.season, err)
		}
		if got != test.want {
			t.Fatalf("seasonStartYear(%q) = %d, want %d", test.season, got, test.want)
		}
	}
}

func TestCanonicalClubNameMatchesSeedNames(t *testing.T) {
	t.Parallel()
	pairs := [][2]string{
		{"SL Benfica", "Sport Lisboa e Benfica"},
		{"FC Porto", "FC Porto"},
		{"SC Braga", "Sporting Clube de Braga"},
		{"CF Estrela da Amadora", "Estrela Amadora"},
		{"AVS Futebol SAD", "AVS"},
	}
	for _, pair := range pairs {
		left := canonicalClubName(pair[0])
		right := canonicalClubName(pair[1])
		if left != right {
			t.Errorf("canonical names differ: %q => %q, %q => %q", pair[0], left, pair[1], right)
		}
	}
}

func TestMapFDStatus(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"SCHEDULED": "scheduled",
		"POSTPONED": "scheduled",
		"PST":       "scheduled",
		"IN_PLAY":   "live",
		"PAUSED":    "live",
		"FINISHED":  "finished",
		"AWARDED":   "finished",
		"NS":        "scheduled",
		"1H":        "live",
		"HT":        "live",
		"FT":        "finished",
	}
	for input, want := range tests {
		if got := mapFDStatus(input); got != want {
			t.Errorf("mapFDStatus(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsProviderPostponedStatus(t *testing.T) {
	t.Parallel()
	if !isProviderPostponedStatus("PST") || !isProviderPostponedStatus("POSTPONED") {
		t.Fatal("PST/POSTPONED should be postponed")
	}
	if isProviderPostponedStatus("NS") || isProviderPostponedStatus("FT") {
		t.Fatal("NS/FT should not be postponed")
	}
}

func TestResolveCompetitionCode(t *testing.T) {
	t.Parallel()
	if got := resolveCompetitionCode("PPL"); got != "94" {
		t.Fatalf("PPL => %q, want 94", got)
	}
	if got := resolveCompetitionCode("94"); got != "94" {
		t.Fatalf("94 => %q, want 94", got)
	}
	if got := resolveCompetitionCode(""); got != "" {
		t.Fatalf("empty => %q", got)
	}
}

func TestIsLegacyTeamExternalID(t *testing.T) {
	t.Parallel()
	fd := "fd-123"
	af := "af-131"
	empty := ""
	if !isLegacyTeamExternalID(nil) {
		t.Fatal("nil should be legacy")
	}
	if !isLegacyTeamExternalID(&empty) {
		t.Fatal("empty should be legacy")
	}
	if !isLegacyTeamExternalID(&fd) {
		t.Fatal("fd-* should be legacy")
	}
	if isLegacyTeamExternalID(&af) {
		t.Fatal("af-* must not be remapped via TLA")
	}
}

func TestFindMatchForRemap(t *testing.T) {
	t.Parallel()
	home, away := "h1", "a1"
	round := 4
	rows := []existingMatch{
		{
			ID:              "m1",
			ExternalID:      "fd-1",
			HomeTeamID:      &home,
			AwayTeamID:      &away,
			KickoffAt:       "2026-08-01T19:00:00Z",
			RoundOrMatchday: &round,
		},
	}
	used := map[string]bool{}
	desired := matchRow{
		HomeTeamID:      "h1",
		AwayTeamID:      "a1",
		KickoffAt:       "2026-08-01T19:01:00Z",
		RoundOrMatchday: &round,
		ExternalID:      "af-9",
	}
	got, ok := findMatchForRemap(rows, desired, used)
	if !ok || got.ID != "m1" {
		t.Fatalf("expected remap within 2m, got ok=%v id=%s", ok, got.ID)
	}

	desired.KickoffAt = "2026-08-01T15:00:00Z" // same day, different time
	got, ok = findMatchForRemap(rows, desired, used)
	if !ok || got.ID != "m1" {
		t.Fatalf("expected same-day fallback, got ok=%v id=%s", ok, got.ID)
	}

	desired.KickoffAt = "2026-08-02T15:00:00Z"
	got, ok = findMatchForRemap(rows, desired, used)
	if !ok || got.ID != "m1" {
		t.Fatalf("expected round fallback, got ok=%v id=%s", ok, got.ID)
	}
}

func TestMapFDMatch(t *testing.T) {
	t.Parallel()
	matchday := 4
	homeScore, awayScore := 2, 1
	match := fdMatch{
		ID:       123,
		UTCDate:  "2025-09-01T20:15:00Z",
		Status:   "FINISHED",
		Matchday: &matchday,
		Stage:    "REGULAR_SEASON",
		HomeTeam: fdTeam{ID: 1, Name: "Home"},
		AwayTeam: fdTeam{ID: 2, Name: "Away"},
	}
	match.Score.FullTime.Home = &homeScore
	match.Score.FullTime.Away = &awayScore

	comp := competition{ID: "competition-id", ExternalProvider: "football-data"}
	teams := map[string]string{"fd-1": "home-id", "fd-2": "away-id"}
	row, ok, err := mapFDMatch(comp, teams, match)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected the match to resolve")
	}
	if row.ExternalID != "fd-123" || row.Status != "finished" {
		t.Fatalf("unexpected mapped row: %+v", row)
	}
	if row.HomeScore == nil || *row.HomeScore != 2 || row.AwayScore == nil || *row.AwayScore != 1 {
		t.Fatalf("unexpected mapped score: home=%v away=%v", row.HomeScore, row.AwayScore)
	}
	if row.KickoffAt != time.Date(2025, 9, 1, 20, 15, 0, 0, time.UTC).Format(time.RFC3339) {
		t.Fatalf("unexpected kickoff: %s", row.KickoffAt)
	}
}

func TestMapFDMatchPrefersRegularTimeFor90(t *testing.T) {
	t.Parallel()
	regH, regA := 1, 1
	ftH, ftA := 2, 1 // includes ET
	etH, etA := 2, 1
	penH, penA := 4, 3
	match := fdMatch{
		ID:       99,
		UTCDate:  "2025-09-01T20:15:00Z",
		Status:   "FINISHED",
		Stage:    "FINAL",
		HomeTeam: fdTeam{ID: 1},
		AwayTeam: fdTeam{ID: 2},
	}
	match.Score.RegularTime.Home = &regH
	match.Score.RegularTime.Away = &regA
	match.Score.FullTime.Home = &ftH
	match.Score.FullTime.Away = &ftA
	match.Score.ExtraTime.Home = &etH
	match.Score.ExtraTime.Away = &etA
	match.Score.Penalties.Home = &penH
	match.Score.Penalties.Away = &penA

	row, ok, err := mapFDMatch(
		competition{ID: "c", ExternalProvider: "football-data"},
		map[string]string{"fd-1": "h", "fd-2": "a"},
		match,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected resolve")
	}
	if *row.HomeScore != 1 || *row.AwayScore != 1 {
		t.Fatalf("90' want 1-1 got %v-%v", *row.HomeScore, *row.AwayScore)
	}
	if row.ETHomeScore == nil || *row.ETHomeScore != 2 || row.ETAwayScore == nil || *row.ETAwayScore != 1 {
		t.Fatalf("ET want 2-1 got %v-%v", row.ETHomeScore, row.ETAwayScore)
	}
	if row.PenHomeScore == nil || *row.PenHomeScore != 4 {
		t.Fatalf("PEN want 4-3 got %v-%v", row.PenHomeScore, row.PenAwayScore)
	}
}

func TestAFFixturesToFDUsesFulltimeAs90(t *testing.T) {
	t.Parallel()
	ftH, ftA := 1, 1
	goalsH, goalsA := 2, 1
	etH, etA := 2, 1
	penH, penA := 5, 4
	f := afFixture{}
	f.Fixture.ID = 10
	f.Fixture.Date = "2025-09-01T20:15:00Z"
	f.Fixture.Status.Short = "PEN"
	f.Teams.Home.ID = 1
	f.Teams.Away.ID = 2
	f.Goals.Home = &goalsH
	f.Goals.Away = &goalsA
	f.Score.Fulltime.Home = &ftH
	f.Score.Fulltime.Away = &ftA
	f.Score.Extratime.Home = &etH
	f.Score.Extratime.Away = &etA
	f.Score.Penalty.Home = &penH
	f.Score.Penalty.Away = &penA

	out := afFixturesToFD([]afFixture{f})
	if len(out) != 1 {
		t.Fatal(out)
	}
	m := out[0]
	if m.Score.RegularTime.Home == nil || *m.Score.RegularTime.Home != 1 {
		t.Fatalf("regularTime want 1-1, got %+v", m.Score.RegularTime)
	}
	if m.Score.ExtraTime.Home == nil || *m.Score.ExtraTime.Home != 2 {
		t.Fatalf("extraTime want 2-1, got %+v", m.Score.ExtraTime)
	}
	if m.Score.Penalties.Home == nil || *m.Score.Penalties.Home != 5 {
		t.Fatalf("penalties want 5-4, got %+v", m.Score.Penalties)
	}
}

func TestMapFDMatchRequiresKnownTeams(t *testing.T) {
	t.Parallel()
	match := fdMatch{
		ID:       123,
		UTCDate:  "2025-09-01T20:15:00Z",
		Status:   "SCHEDULED",
		HomeTeam: fdTeam{ID: 1},
		AwayTeam: fdTeam{ID: 2},
	}
	_, ok, err := mapFDMatch(
		competition{ExternalProvider: "football-data"},
		map[string]string{"fd-1": "home-id"},
		match,
	)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected unresolved match when one team is missing")
	}
}

func TestIsTransientNetError(t *testing.T) {
	t.Parallel()
	cases := []struct {
		msg  string
		want bool
	}{
		{"Patch \"https://x\": context deadline exceeded (Client.Timeout exceeded while awaiting headers)", true},
		{"i/o timeout", true},
		{"connection reset by peer", true},
		{"Supabase request failed: status=400 body=bad", false},
	}
	for _, tc := range cases {
		got := isTransientNetError(fmt.Errorf("%s", tc.msg))
		if got != tc.want {
			t.Errorf("isTransientNetError(%q)=%v want %v", tc.msg, got, tc.want)
		}
	}
	if !isTransientNetError(context.DeadlineExceeded) {
		t.Fatal("DeadlineExceeded should be transient")
	}
}

func TestIsProviderUnavailable(t *testing.T) {
	t.Parallel()
	if !isProviderUnavailable(fmt.Errorf("api-football /fixtures: HTTP 404: not found")) {
		t.Fatal("404 should skip")
	}
	if isProviderUnavailable(fmt.Errorf("api-football /fixtures: HTTP 429: rate limit")) {
		t.Fatal("429 should be retried/collected, not treated as unpublished season")
	}
}

func TestRateLimited(t *testing.T) {
	t.Parallel()
	if !rateLimited(map[string]any{"rateLimit": "Too many requests"}) {
		t.Fatal("expected rate limit map")
	}
	if rateLimited(nil) || rateLimited("") || rateLimited([]any{}) {
		t.Fatal("empty errors should not look rate-limited")
	}
}

func TestIsTransientHTTPStatus(t *testing.T) {
	t.Parallel()
	if !isTransientHTTPStatus(503) || !isTransientHTTPStatus(429) {
		t.Fatal("503/429 should be transient")
	}
	if isTransientHTTPStatus(400) || isTransientHTTPStatus(404) {
		t.Fatal("400/404 should not be transient")
	}
}

func TestPlanKnockoutTiesPairsReturnLegs(t *testing.T) {
	t.Parallel()
	phase := "round_of_16"
	homeA, awayA := "team-a", "team-b"
	homeB, awayB := "team-b", "team-a"
	rows := []existingMatch{
		{
			ID: "m1", Phase: &phase, HomeTeamID: &homeA, AwayTeamID: &awayA,
			KickoffAt: "2026-03-10T20:00:00Z",
		},
		{
			ID: "m2", Phase: &phase, HomeTeamID: &homeB, AwayTeamID: &awayB,
			KickoffAt: "2026-03-17T20:00:00Z",
		},
	}
	got := planKnockoutTies(rows)
	first := got["m1"]
	second := got["m2"]
	if first.legKind == nil || *first.legKind != "first" {
		t.Fatalf("m1 leg_kind=%v", first.legKind)
	}
	if second.legKind == nil || *second.legKind != "second" {
		t.Fatalf("m2 leg_kind=%v", second.legKind)
	}
	if first.tieID == nil || second.tieID == nil || *first.tieID != *second.tieID {
		t.Fatalf("tie_id mismatch: %v vs %v", first.tieID, second.tieID)
	}
}

func TestPlanKnockoutTiesFinalSingle(t *testing.T) {
	t.Parallel()
	phase := "final"
	home, away := "team-a", "team-b"
	rows := []existingMatch{
		{
			ID: "mf", Phase: &phase, HomeTeamID: &home, AwayTeamID: &away,
			KickoffAt: "2026-06-01T19:00:00Z",
		},
	}
	got := planKnockoutTies(rows)
	want := got["mf"]
	if want.legKind == nil || *want.legKind != "final_single" {
		t.Fatalf("leg_kind=%v", want.legKind)
	}
	if want.tieID != nil {
		t.Fatalf("final should not have tie_id, got %v", *want.tieID)
	}
}
