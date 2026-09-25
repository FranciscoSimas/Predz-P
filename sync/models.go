package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type competition struct {
	ID               string `json:"id"`
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	Season           string `json:"season"`
	ExternalProvider string `json:"external_provider"`
	ExternalID       string `json:"external_id"`
}

type teamRow struct {
	ID               string  `json:"id,omitempty"`
	CompetitionID    string  `json:"competition_id,omitempty"`
	Name             string  `json:"name"`
	ShortName        *string `json:"short_name"`
	CrestURL         *string `json:"crest_url"`
	CrestOverrideURL *string `json:"crest_override_url,omitempty"`
	ExternalID       *string `json:"external_id"`
}

func (t teamRow) hasCrestOverride() bool {
	return t.CrestOverrideURL != nil && strings.TrimSpace(*t.CrestOverrideURL) != ""
}

type matchRow struct {
	ID              string  `json:"id,omitempty"`
	CompetitionID   string  `json:"competition_id"`
	Phase           *string `json:"phase"`
	RoundOrMatchday *int    `json:"round_or_matchday"`
	GroupLetter     *string `json:"group_letter"`
	HomeTeamID      string  `json:"home_team_id"`
	AwayTeamID      string  `json:"away_team_id"`
	KickoffAt       string  `json:"kickoff_at"`
	Status          string  `json:"status"`
	HomeScore       *int    `json:"home_score"`
	AwayScore       *int    `json:"away_score"`
	ETHomeScore     *int    `json:"et_home_score"`
	ETAwayScore     *int    `json:"et_away_score"`
	PenHomeScore    *int    `json:"pen_home_score"`
	PenAwayScore    *int    `json:"pen_away_score"`
	LiveMinute      *int    `json:"live_minute"`
	ExternalID      string  `json:"external_id"`
	IsPostponed     bool    `json:"is_postponed"`
	TieID           *string `json:"tie_id,omitempty"`
	LegKind         *string `json:"leg_kind,omitempty"`
}

type existingMatch struct {
	ID              string  `json:"id"`
	CompetitionID   string  `json:"competition_id"`
	Phase           *string `json:"phase"`
	RoundOrMatchday *int    `json:"round_or_matchday"`
	GroupLetter     *string `json:"group_letter"`
	HomeTeamID      *string `json:"home_team_id"`
	AwayTeamID      *string `json:"away_team_id"`
	KickoffAt       string  `json:"kickoff_at"`
	Status          string  `json:"status"`
	HomeScore       *int    `json:"home_score"`
	AwayScore       *int    `json:"away_score"`
	ETHomeScore     *int    `json:"et_home_score"`
	ETAwayScore     *int    `json:"et_away_score"`
	PenHomeScore    *int    `json:"pen_home_score"`
	PenAwayScore    *int    `json:"pen_away_score"`
	LiveMinute      *int    `json:"live_minute"`
	ExternalID      string  `json:"external_id"`
	ManualOverride  bool    `json:"manual_override"`
	IsPostponed     bool    `json:"is_postponed"`
	TieID           *string `json:"tie_id"`
	LegKind         *string `json:"leg_kind"`
}

func providerExternalID(provider string, id int) string {
	prefix := provider
	switch provider {
	case "football-data":
		prefix = "fd"
	case "api-football":
		prefix = "af"
	}
	return prefix + "-" + strconv.Itoa(id)
}

func seasonStartYear(season string) (int, error) {
	cleaned := strings.TrimSpace(season)
	parts := strings.FieldsFunc(cleaned, func(r rune) bool {
		return r == '/' || r == '-' || unicode.IsSpace(r)
	})
	if len(parts) == 0 {
		return 0, fmt.Errorf("invalid season %q", season)
	}

	year, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, fmt.Errorf("invalid season %q: %w", season, err)
	}
	if year < 100 {
		year += 2000
	}
	if year < 2000 || year > time.Now().UTC().Year()+1 {
		return 0, fmt.Errorf("season start year %d is outside the supported range", year)
	}
	return year, nil
}

func canonicalClubName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Map(func(r rune) rune {
		switch r {
		case 'á', 'à', 'â', 'ã', 'ä':
			return 'a'
		case 'é', 'è', 'ê', 'ë':
			return 'e'
		case 'í', 'ì', 'î', 'ï':
			return 'i'
		case 'ó', 'ò', 'ô', 'õ', 'ö':
			return 'o'
		case 'ú', 'ù', 'û', 'ü':
			return 'u'
		case 'ç':
			return 'c'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return ' '
	}, value)

	stopWords := map[string]bool{
		"ac": true, "cd": true, "cf": true, "clube": true, "da": true, "de": true,
		"do": true, "e": true, "fc": true, "futebol": true, "gd": true, "lisboa": true,
		"sad": true, "sc": true, "sl": true, "sport": true,
	}
	words := strings.Fields(value)
	filtered := words[:0]
	for _, word := range words {
		if !stopWords[word] {
			filtered = append(filtered, word)
		}
	}
	key := strings.Join(filtered, " ")
	aliases := map[string]string{
		"sporting braga":    "braga",
		"sporting portugal": "sporting cp",
	}
	if alias, ok := aliases[key]; ok {
		return alias
	}
	return key
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func afPlayerPhotoURL(playerID int, apiPhoto string) *string {
	if p := stringPointer(apiPhoto); p != nil {
		return p
	}
	if playerID <= 0 {
		return nil
	}
	u := fmt.Sprintf("https://media.api-sports.io/football/players/%d.png", playerID)
	return &u
}

func intPointer(value int) *int {
	return &value
}
