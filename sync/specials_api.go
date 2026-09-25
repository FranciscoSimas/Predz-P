package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type afSquadPlayer struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Age      *int   `json:"age"`
	Number   *int   `json:"number"`
	Position string `json:"position"`
	Photo    string `json:"photo"`
}

type afTopScorerRow struct {
	Player struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
		Photo string `json:"photo"`
	} `json:"player"`
	Statistics []struct {
		Team struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"team"`
		Goals struct {
			Total *int `json:"total"`
		} `json:"goals"`
	} `json:"statistics"`
}

type afPlayerDetailRow struct {
	Player struct {
		ID    int    `json:"id"`
		Name  string `json:"name"`
		Photo string `json:"photo"`
	} `json:"player"`
	Statistics []struct {
		League struct {
			ID   int    `json:"id"`
			Season int  `json:"season"`
		} `json:"league"`
		Team struct {
			ID int `json:"id"`
		} `json:"team"`
		Goals struct {
			Total *int `json:"total"`
		} `json:"goals"`
	} `json:"statistics"`
}

func (c *apiFootballClient) squad(ctx context.Context, teamID int) ([]afSquadPlayer, error) {
	q := url.Values{}
	q.Set("team", strconv.Itoa(teamID))
	var rows []struct {
		Players []afSquadPlayer `json:"players"`
	}
	if err := c.get(ctx, "/players/squads", q, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0].Players, nil
}

func (c *apiFootballClient) topScorers(ctx context.Context, leagueID, season int) ([]afTopScorerRow, error) {
	q := url.Values{}
	q.Set("league", strconv.Itoa(leagueID))
	q.Set("season", strconv.Itoa(season))
	var rows []afTopScorerRow
	if err := c.get(ctx, "/players/topscorers", q, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *apiFootballClient) playerSeason(ctx context.Context, playerID, season int) (*afPlayerDetailRow, error) {
	q := url.Values{}
	q.Set("id", strconv.Itoa(playerID))
	q.Set("season", strconv.Itoa(season))
	var rows []afPlayerDetailRow
	if err := c.get(ctx, "/players", q, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("player %d not found", playerID)
	}
	return &rows[0], nil
}

type afFixtureEvent struct {
	Type   string `json:"type"`
	Detail string `json:"detail"`
	Player struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"player"`
}

func (c *apiFootballClient) fixtureEvents(ctx context.Context, fixtureID int) ([]afFixtureEvent, error) {
	q := url.Values{}
	q.Set("fixture", strconv.Itoa(fixtureID))
	var rows []afFixtureEvent
	if err := c.get(ctx, "/fixtures/events", q, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

type playerRow struct {
	CompetitionID string  `json:"competition_id"`
	TeamID        *string `json:"team_id,omitempty"`
	ExternalID    string  `json:"external_id"`
	Name          string  `json:"name"`
	PhotoURL      *string `json:"photo_url,omitempty"`
	Position      *string `json:"position,omitempty"`
	ShirtNumber   *int    `json:"shirt_number,omitempty"`
}

type playerStatsRow struct {
	CompetitionID    string `json:"competition_id"`
	PlayerExternalID string `json:"player_external_id"`
	Season           string `json:"season"`
	Goals            int    `json:"goals"`
}

func (c *supabaseClient) upsertPlayers(ctx context.Context, rows []playerRow) error {
	if len(rows) == 0 {
		return nil
	}
	const chunk = 80
	for start := 0; start < len(rows); start += chunk {
		end := min(start+chunk, len(rows))
		if err := c.requestJSON(
			ctx,
			http.MethodPost,
			"/competition_players?on_conflict=competition_id,external_id",
			rows[start:end],
			"resolution=merge-duplicates,return=minimal",
			nil,
		); err != nil {
			return err
		}
	}
	return nil
}

func (c *supabaseClient) upsertPlayerStats(ctx context.Context, rows []playerStatsRow) error {
	if len(rows) == 0 {
		return nil
	}
	const chunk = 80
	for start := 0; start < len(rows); start += chunk {
		end := min(start+chunk, len(rows))
		if err := c.requestJSON(
			ctx,
			http.MethodPost,
			"/player_season_stats?on_conflict=competition_id,player_external_id,season",
			rows[start:end],
			"resolution=merge-duplicates,return=minimal",
			nil,
		); err != nil {
			return err
		}
	}
	return nil
}

func (c *supabaseClient) playerSeasonStats(ctx context.Context, competitionID, season string) ([]playerStatsRow, error) {
	params := url.Values{}
	params.Set("select", "competition_id,player_external_id,season,goals")
	params.Set("competition_id", "eq."+competitionID)
	params.Set("season", "eq."+season)
	var rows []playerStatsRow
	if err := c.requestJSON(ctx, http.MethodGet, "/player_season_stats?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) distinctTopScorerExternalIDs(ctx context.Context, competitionID string) ([]string, error) {
	params := url.Values{}
	params.Set("select", "player_external_id")
	params.Set("bet_type", "eq.top_scorer")
	params.Set("player_external_id", "not.is.null")
	// Filter via tournaments of this competition — join not available; fetch then filter in Go
	var rows []struct {
		PlayerExternalID string `json:"player_external_id"`
		TournamentID     string `json:"tournament_id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/special_bets?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	tParams := url.Values{}
	tParams.Set("select", "id")
	tParams.Set("competition_id", "eq."+competitionID)
	var tournaments []struct {
		ID string `json:"id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/tournaments?"+tParams.Encode(), nil, "", &tournaments); err != nil {
		return nil, err
	}
	allowed := make(map[string]bool, len(tournaments))
	for _, t := range tournaments {
		allowed[t.ID] = true
	}
	seen := make(map[string]bool)
	out := make([]string, 0)
	for _, r := range rows {
		if !allowed[r.TournamentID] || r.PlayerExternalID == "" || seen[r.PlayerExternalID] {
			continue
		}
		seen[r.PlayerExternalID] = true
		out = append(out, r.PlayerExternalID)
	}
	return out, nil
}

// playerExternalIDsOnTeams returns competition_players.external_id for the given team UUIDs.
func (c *supabaseClient) playerExternalIDsOnTeams(
	ctx context.Context,
	competitionID string,
	teamUUIDs map[string]bool,
) (map[string]bool, error) {
	ids := make([]string, 0, len(teamUUIDs))
	for id := range teamUUIDs {
		if id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return map[string]bool{}, nil
	}
	params := url.Values{}
	params.Set("select", "external_id")
	params.Set("competition_id", "eq."+competitionID)
	params.Set("team_id", "in.("+strings.Join(ids, ",")+")")
	var rows []struct {
		ExternalID string `json:"external_id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/competition_players?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		if r.ExternalID != "" {
			out[r.ExternalID] = true
		}
	}
	return out, nil
}

func (c *supabaseClient) patchTournamentOfficials(
	ctx context.Context,
	competitionID string,
	winnerTeamID *string,
	topScorerName *string,
	topScorerGoals *int,
	topScorerExtID *string,
) error {
	tParams := url.Values{}
	tParams.Set("select", "id")
	tParams.Set("competition_id", "eq."+competitionID)
	var tournaments []struct {
		ID string `json:"id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/tournaments?"+tParams.Encode(), nil, "", &tournaments); err != nil {
		return err
	}
	if len(tournaments) == 0 {
		return nil
	}
	ids := make([]string, 0, len(tournaments))
	for _, t := range tournaments {
		ids = append(ids, t.ID)
	}
	payload := map[string]any{}
	if winnerTeamID != nil {
		payload["official_winner_team_id"] = *winnerTeamID
	}
	if topScorerName != nil {
		payload["official_top_scorer"] = *topScorerName
	}
	if topScorerGoals != nil {
		payload["official_top_scorer_goals"] = *topScorerGoals
	}
	if topScorerExtID != nil {
		payload["official_top_scorer_external_id"] = *topScorerExtID
	}
	if len(payload) == 0 {
		return nil
	}
	params := url.Values{}
	params.Set("tournament_id", "in.("+strings.Join(ids, ",")+")")
	return c.requestJSON(ctx, http.MethodPatch, "/tournament_settings?"+params.Encode(), payload, "return=minimal", nil)
}

func (c *supabaseClient) recalcSpecialBetsForCompetition(ctx context.Context, competitionID string) (int, error) {
	var n int
	err := c.requestJSON(
		ctx,
		http.MethodPost,
		"/rpc/recalc_special_bets_for_competition",
		map[string]any{"_competition_id": competitionID},
		"",
		&n,
	)
	return n, err
}

func (c *supabaseClient) competitionFormat(ctx context.Context, competitionID string) (string, error) {
	params := url.Values{}
	params.Set("select", "format")
	params.Set("id", "eq."+competitionID)
	var rows []struct {
		Format string `json:"format"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/competitions?"+params.Encode(), nil, "", &rows); err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", fmt.Errorf("competition %s not found", competitionID)
	}
	return rows[0].Format, nil
}

func (c *supabaseClient) finishedMatchesForStandings(ctx context.Context, competitionID string) ([]existingMatch, error) {
	params := url.Values{}
	params.Set(
		"select",
		"id,competition_id,phase,round_or_matchday,home_team_id,away_team_id,status,"+
			"home_score,away_score,et_home_score,et_away_score,pen_home_score,pen_away_score,kickoff_at,external_id,manual_override",
	)
	params.Set("competition_id", "eq."+competitionID)
	params.Set("status", "eq.finished")
	var rows []existingMatch
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) remainingMatchCounts(ctx context.Context, competitionID string) (map[string]int, error) {
	params := url.Values{}
	params.Set("select", "home_team_id,away_team_id,status")
	params.Set("competition_id", "eq."+competitionID)
	params.Set("status", "in.(scheduled,live)")
	var rows []struct {
		HomeTeamID *string `json:"home_team_id"`
		AwayTeamID *string `json:"away_team_id"`
		Status     string  `json:"status"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	out := make(map[string]int)
	for _, r := range rows {
		if r.HomeTeamID != nil {
			out[*r.HomeTeamID]++
		}
		if r.AwayTeamID != nil {
			out[*r.AwayTeamID]++
		}
	}
	return out, nil
}
