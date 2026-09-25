package main

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// syncSpecialsDaily runs after teams/fixtures on daily mode:
// squads, topscorers, refresh chosen players' goals, clinch/knockout winner.
func (s *syncService) syncSpecialsDaily(
	ctx context.Context,
	comp competition,
	teamIDs map[string]string, // provider external id "af-123" -> uuid
) error {
	if comp.ExternalProvider != "api-football" || s.apiFootball == nil {
		return nil
	}
	leagueID, err := strconv.Atoi(comp.ExternalID)
	if err != nil {
		return fmt.Errorf("league id: %w", err)
	}
	season, err := seasonStartYear(comp.Season)
	if err != nil {
		return err
	}

	// Reverse map: af team id int -> uuid
	afTeamUUID := make(map[int]string)
	for ext, uuid := range teamIDs {
		if !strings.HasPrefix(ext, "af-") {
			continue
		}
		id, err := strconv.Atoi(strings.TrimPrefix(ext, "af-"))
		if err != nil {
			continue
		}
		afTeamUUID[id] = uuid
	}

	if err := s.syncSquads(ctx, comp, afTeamUUID); err != nil {
		s.logger.Warn("squads sync failed", "competition", comp.Name, "error", err.Error())
	}
	if err := s.syncTopScorersAndOfficial(ctx, comp, leagueID, season, afTeamUUID); err != nil {
		s.logger.Warn("topscorers sync failed", "competition", comp.Name, "error", err.Error())
	}
	if err := s.refreshChosenPlayerGoals(ctx, comp, leagueID, season, nil); err != nil {
		s.logger.Warn("chosen player refresh failed", "competition", comp.Name, "error", err.Error())
	}
	if err := s.overlayGoalsFromRecentEvents(ctx, comp); err != nil {
		s.logger.Warn("fixture-event goals overlay failed", "competition", comp.Name, "error", err.Error())
	}
	if err := s.resolveOfficialWinner(ctx, comp); err != nil {
		s.logger.Warn("official winner resolve failed", "competition", comp.Name, "error", err.Error())
	}

	if !s.cfg.DryRun {
		n, err := s.supabase.recalcSpecialBetsForCompetition(ctx, comp.ID)
		if err != nil {
			s.logger.Warn("recalc_special_bets_for_competition failed", "error", err.Error())
		} else {
			s.logger.Info("recalc_special_bets_for_competition", "tournaments", n)
		}
	}
	return nil
}

// syncSpecialsMatchday runs after fixtures on matchday mode (only when Actions
// already fired on a score/status delta): refresh goals for chosen top-scorer
// picks on teams that appear in the matchday window, then recalc.
func (s *syncService) syncSpecialsMatchday(
	ctx context.Context,
	comp competition,
	teamIDs map[string]string,
	matches []fdMatch,
) error {
	if comp.ExternalProvider != "api-football" || s.apiFootball == nil {
		return nil
	}
	playing := make(map[string]bool)
	for _, m := range matches {
		if id := teamIDs[providerExternalID(comp.ExternalProvider, m.HomeTeam.ID)]; id != "" {
			playing[id] = true
		}
		if id := teamIDs[providerExternalID(comp.ExternalProvider, m.AwayTeam.ID)]; id != "" {
			playing[id] = true
		}
	}
	if len(playing) == 0 {
		return nil
	}

	leagueID, err := strconv.Atoi(comp.ExternalID)
	if err != nil {
		return fmt.Errorf("league id: %w", err)
	}
	season, err := seasonStartYear(comp.Season)
	if err != nil {
		return err
	}

	if err := s.refreshChosenPlayerGoals(ctx, comp, leagueID, season, playing); err != nil {
		s.logger.Warn("matchday chosen player refresh failed", "competition", comp.Name, "error", err.Error())
	}
	if err := s.overlayGoalsFromRecentEvents(ctx, comp); err != nil {
		s.logger.Warn("matchday fixture-event goals overlay failed", "competition", comp.Name, "error", err.Error())
	}

	if !s.cfg.DryRun {
		n, err := s.supabase.recalcSpecialBetsForCompetition(ctx, comp.ID)
		if err != nil {
			s.logger.Warn("recalc_special_bets_for_competition failed", "error", err.Error())
		} else if n > 0 {
			s.logger.Info("matchday recalc_special_bets", "competition", comp.Name, "tournaments", n)
		}
	}
	return nil
}

func (s *syncService) syncSquads(ctx context.Context, comp competition, afTeamUUID map[int]string) error {
	rows := make([]playerRow, 0, 400)
	for afID, teamUUID := range afTeamUUID {
		players, err := s.apiFootball.squad(ctx, afID)
		if err != nil {
			s.logger.Warn("squad fetch failed", "team_af", afID, "error", err.Error())
			continue
		}
		tid := teamUUID
		for _, p := range players {
			if p.ID == 0 || strings.TrimSpace(p.Name) == "" {
				continue
			}
			ext := providerExternalID("api-football", p.ID)
			row := playerRow{
				CompetitionID: comp.ID,
				TeamID:        &tid,
				ExternalID:    ext,
				Name:          strings.TrimSpace(p.Name),
				PhotoURL:      afPlayerPhotoURL(p.ID, p.Photo),
				Position:      stringPointer(p.Position),
				ShirtNumber:   p.Number,
			}
			rows = append(rows, row)
		}
	}
	if s.cfg.DryRun {
		s.logger.Info("dry-run squads", "competition", comp.Name, "players", len(rows))
		return nil
	}
	return s.supabase.upsertPlayers(ctx, rows)
}

func (s *syncService) syncTopScorersAndOfficial(
	ctx context.Context,
	comp competition,
	leagueID, season int,
	afTeamUUID map[int]string,
) error {
	scorers, err := s.apiFootball.topScorers(ctx, leagueID, season)
	if err != nil {
		return err
	}
	statsRows := make([]playerStatsRow, 0, len(scorers))
	playerRows := make([]playerRow, 0, len(scorers))
	var topName *string
	var topGoals *int
	var topExt *string

	for i, row := range scorers {
		if row.Player.ID == 0 {
			continue
		}
		ext := providerExternalID("api-football", row.Player.ID)
		goals := 0
		var teamUUID *string
		if len(row.Statistics) > 0 {
			if row.Statistics[0].Goals.Total != nil {
				goals = *row.Statistics[0].Goals.Total
			}
			if tid, ok := afTeamUUID[row.Statistics[0].Team.ID]; ok {
				teamUUID = &tid
			}
		}
		statsRows = append(statsRows, playerStatsRow{
			CompetitionID:    comp.ID,
			PlayerExternalID: ext,
			Season:           comp.Season,
			Goals:            goals,
		})
		playerRows = append(playerRows, playerRow{
			CompetitionID: comp.ID,
			TeamID:        teamUUID,
			ExternalID:    ext,
			Name:          strings.TrimSpace(row.Player.Name),
			PhotoURL:      afPlayerPhotoURL(row.Player.ID, row.Player.Photo),
		})
		if i == 0 {
			n := strings.TrimSpace(row.Player.Name)
			topName = &n
			g := goals
			topGoals = &g
			e := ext
			topExt = &e
		}
	}

	if s.cfg.DryRun {
		s.logger.Info("dry-run topscorers", "competition", comp.Name, "n", len(statsRows))
		return nil
	}
	if err := s.supabase.upsertPlayers(ctx, playerRows); err != nil {
		return err
	}
	if err := s.supabase.upsertPlayerStats(ctx, statsRows); err != nil {
		return err
	}
	// Always publish current #1 as official top scorer (player_match uses it;
	// per_goal uses each pick's stats; goals column still useful for display/fallback).
	return s.supabase.patchTournamentOfficials(ctx, comp.ID, nil, topName, topGoals, topExt)
}

func (s *syncService) refreshChosenPlayerGoals(
	ctx context.Context,
	comp competition,
	leagueID, season int,
	onlyTeamUUIDs map[string]bool, // nil = all picks; non-nil = only picks on these teams
) error {
	ids, err := s.supabase.distinctTopScorerExternalIDs(ctx, comp.ID)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	if len(onlyTeamUUIDs) > 0 {
		onTeams, err := s.supabase.playerExternalIDsOnTeams(ctx, comp.ID, onlyTeamUUIDs)
		if err != nil {
			return err
		}
		filtered := ids[:0]
		for _, ext := range ids {
			if onTeams[ext] {
				filtered = append(filtered, ext)
			}
		}
		ids = filtered
		if len(ids) == 0 {
			s.logger.Info(
				"matchday top-scorer refresh: no chosen picks on playing teams",
				"competition", comp.Name,
			)
			return nil
		}
	}
	statsRows := make([]playerStatsRow, 0, len(ids))
	for _, ext := range ids {
		afID, err := strconv.Atoi(strings.TrimPrefix(ext, "af-"))
		if err != nil || !strings.HasPrefix(ext, "af-") {
			continue
		}
		detail, err := s.apiFootball.playerSeason(ctx, afID, season)
		if err != nil {
			s.logger.Warn("player refresh failed", "player", ext, "error", err.Error())
			continue
		}
		goals := 0
		for _, st := range detail.Statistics {
			if st.League.ID == leagueID && st.Goals.Total != nil {
				goals = *st.Goals.Total
				break
			}
		}
		statsRows = append(statsRows, playerStatsRow{
			CompetitionID:    comp.ID,
			PlayerExternalID: ext,
			Season:           comp.Season,
			Goals:            goals,
		})
	}
	if s.cfg.DryRun {
		s.logger.Info("dry-run refresh chosen", "n", len(statsRows))
		return nil
	}
	if len(statsRows) == 0 {
		return nil
	}
	s.logger.Info("refreshed chosen top-scorer goals", "competition", comp.Name, "players", len(statsRows))
	return s.supabase.upsertPlayerStats(ctx, statsRows)
}

func countLeagueGoalsFromEvents(events []afFixtureEvent) map[int]int {
	out := make(map[int]int)
	for _, ev := range events {
		if !strings.EqualFold(strings.TrimSpace(ev.Type), "Goal") {
			continue
		}
		detail := strings.ToLower(ev.Detail)
		if strings.Contains(detail, "own") || strings.Contains(detail, "missed") {
			continue
		}
		if ev.Player.ID == 0 {
			continue
		}
		out[ev.Player.ID]++
	}
	return out
}

// overlayGoalsFromRecentEvents counts Goal events on finished fixtures from the
// last 21 days. /players/topscorers and /players lag behind fixture scores
// (e.g. Pavlidis hat-trick still showing 1). GREATEST keeps API totals if they
// are already ahead of the recent-window event count.
func (s *syncService) overlayGoalsFromRecentEvents(ctx context.Context, comp competition) error {
	if s.apiFootball == nil {
		return nil
	}
	matches, err := s.supabase.matches(ctx, comp.ID)
	if err != nil {
		return err
	}
	cutoff := s.now().Add(-21 * 24 * time.Hour)
	eventGoals := make(map[int]int)
	eventNames := make(map[int]string)
	fetched := 0
	for _, m := range matches {
		if m.Status != "finished" || !strings.HasPrefix(m.ExternalID, "af-") {
			continue
		}
		ko, err := time.Parse(time.RFC3339, m.KickoffAt)
		if err != nil {
			ko, err = time.Parse(time.RFC3339Nano, m.KickoffAt)
		}
		if err != nil || ko.Before(cutoff) {
			continue
		}
		fid, err := strconv.Atoi(strings.TrimPrefix(m.ExternalID, "af-"))
		if err != nil {
			continue
		}
		events, err := s.apiFootball.fixtureEvents(ctx, fid)
		if err != nil {
			s.logger.Warn("fixture events fetch failed", "fixture", m.ExternalID, "error", err.Error())
			continue
		}
		fetched++
		for afID, n := range countLeagueGoalsFromEvents(events) {
			eventGoals[afID] += n
		}
		for _, ev := range events {
			if ev.Player.ID != 0 && strings.TrimSpace(ev.Player.Name) != "" {
				eventNames[ev.Player.ID] = strings.TrimSpace(ev.Player.Name)
			}
		}
	}
	if len(eventGoals) == 0 {
		return nil
	}

	existing, err := s.supabase.playerSeasonStats(ctx, comp.ID, comp.Season)
	if err != nil {
		return err
	}
	byExt := make(map[string]int, len(existing))
	for _, row := range existing {
		byExt[row.PlayerExternalID] = row.Goals
	}

	statsRows := make([]playerStatsRow, 0, len(eventGoals))
	for afID, n := range eventGoals {
		ext := providerExternalID("api-football", afID)
		goals := n
		if prev, ok := byExt[ext]; ok && prev > goals {
			goals = prev
		}
		byExt[ext] = goals
		statsRows = append(statsRows, playerStatsRow{
			CompetitionID:    comp.ID,
			PlayerExternalID: ext,
			Season:           comp.Season,
			Goals:            goals,
		})
	}

	if s.cfg.DryRun {
		s.logger.Info(
			"dry-run fixture-event goals overlay",
			"competition", comp.Name,
			"fixtures", fetched,
			"players", len(statsRows),
		)
		return nil
	}
	if err := s.supabase.upsertPlayerStats(ctx, statsRows); err != nil {
		return err
	}

	maxGoals := -1
	var topExt string
	for ext, g := range byExt {
		if g > maxGoals {
			maxGoals = g
			topExt = ext
		}
	}
	if maxGoals < 0 || topExt == "" {
		return nil
	}
	topName := ""
	if strings.HasPrefix(topExt, "af-") {
		if afID, err := strconv.Atoi(strings.TrimPrefix(topExt, "af-")); err == nil {
			topName = eventNames[afID]
		}
	}
	s.logger.Info(
		"overlayed fixture-event goals",
		"competition", comp.Name,
		"fixtures", fetched,
		"players", len(statsRows),
		"official_ext", topExt,
		"official_goals", maxGoals,
	)
	if topName == "" {
		return nil
	}
	g := maxGoals
	return s.supabase.patchTournamentOfficials(ctx, comp.ID, nil, &topName, &g, &topExt)
}

type standingRow struct {
	TeamID string
	Played int
	Won    int
	Drawn  int
	Lost   int
	GF     int
	GA     int
	Pts    int
}

func (s *syncService) resolveOfficialWinner(ctx context.Context, comp competition) error {
	format, err := s.supabase.competitionFormat(ctx, comp.ID)
	if err != nil {
		return err
	}

	var winnerUUID *string

	if format == "league" {
		winnerUUID, err = s.clinchLeagueChampion(ctx, comp.ID)
		if err != nil {
			return err
		}
	} else {
		// Knockoutish: finished Final match winner
		matches, err := s.supabase.finishedMatchesForStandings(ctx, comp.ID)
		if err != nil {
			return err
		}
		for _, m := range matches {
			phase := strings.ToLower(strings.TrimSpace(derefStr(m.Phase)))
			// Exact "final" only — avoid matching semi_finals / quarter_finals.
			if phase != "final" {
				continue
			}
			if m.HomeTeamID == nil || m.AwayTeamID == nil {
				continue
			}
			w := matchWinnerUUID(*m.HomeTeamID, *m.AwayTeamID, m)
			if w != "" {
				winnerUUID = &w
				break
			}
		}
	}

	if winnerUUID == nil {
		return nil
	}
	if s.cfg.DryRun {
		s.logger.Info("dry-run official winner", "team", *winnerUUID, "format", format)
		return nil
	}
	return s.supabase.patchTournamentOfficials(ctx, comp.ID, winnerUUID, nil, nil, nil)
}

func (s *syncService) clinchLeagueChampion(ctx context.Context, competitionID string) (*string, error) {
	finished, err := s.supabase.finishedMatchesForStandings(ctx, competitionID)
	if err != nil {
		return nil, err
	}
	remaining, err := s.supabase.remainingMatchCounts(ctx, competitionID)
	if err != nil {
		return nil, err
	}
	table := buildLeagueTable(finished)
	if len(table) == 0 {
		return nil, nil
	}
	sort.SliceStable(table, func(i, j int) bool {
		a, b := table[i], table[j]
		if a.Pts != b.Pts {
			return a.Pts > b.Pts
		}
		gdA, gdB := a.GF-a.GA, b.GF-b.GA
		if gdA != gdB {
			return gdA > gdB
		}
		if a.GF != b.GF {
			return a.GF > b.GF
		}
		return a.TeamID < b.TeamID
	})
	leader := table[0]
	// Mathematical clinch: leader points > max reachable points of every other team
	for _, row := range table[1:] {
		maxOther := row.Pts + 3*remaining[row.TeamID]
		if leader.Pts <= maxOther {
			return nil, nil
		}
	}
	id := leader.TeamID
	return &id, nil
}

func buildLeagueTable(matches []existingMatch) []standingRow {
	byID := make(map[string]*standingRow)
	ensure := func(id string) *standingRow {
		if r, ok := byID[id]; ok {
			return r
		}
		r := &standingRow{TeamID: id}
		byID[id] = r
		return r
	}
	for _, m := range matches {
		if m.HomeTeamID == nil || m.AwayTeamID == nil || m.HomeScore == nil || m.AwayScore == nil {
			continue
		}
		home := ensure(*m.HomeTeamID)
		away := ensure(*m.AwayTeamID)
		hs, as := *m.HomeScore, *m.AwayScore
		// Prefer FT 90' scores for league table (ignore ET/pen for league)
		home.Played++
		away.Played++
		home.GF += hs
		home.GA += as
		away.GF += as
		away.GA += hs
		switch {
		case hs > as:
			home.Won++
			away.Lost++
			home.Pts += 3
		case hs < as:
			away.Won++
			home.Lost++
			away.Pts += 3
		default:
			home.Drawn++
			away.Drawn++
			home.Pts++
			away.Pts++
		}
	}
	out := make([]standingRow, 0, len(byID))
	for _, r := range byID {
		out = append(out, *r)
	}
	return out
}

func matchWinnerUUID(homeID, awayID string, m existingMatch) string {
	// Prefer pens → ET → FT
	if m.PenHomeScore != nil && m.PenAwayScore != nil {
		if *m.PenHomeScore > *m.PenAwayScore {
			return homeID
		}
		if *m.PenAwayScore > *m.PenHomeScore {
			return awayID
		}
	}
	if m.ETHomeScore != nil && m.ETAwayScore != nil {
		if *m.ETHomeScore > *m.ETAwayScore {
			return homeID
		}
		if *m.ETAwayScore > *m.ETHomeScore {
			return awayID
		}
	}
	if m.HomeScore != nil && m.AwayScore != nil {
		if *m.HomeScore > *m.AwayScore {
			return homeID
		}
		if *m.AwayScore > *m.HomeScore {
			return awayID
		}
	}
	return ""
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
