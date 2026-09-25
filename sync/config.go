package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	modeDaily    = "daily"
	modeMatchday = "matchday"
)

type config struct {
	Mode             string
	DryRun           bool
	CompetitionCode  string
	SupabaseURL      string
	SupabaseKey      string
	FootballDataKey  string
	FootballDataURL  string
	APIFootballKey   string
	RequestTimeout   time.Duration
	ProviderInterval time.Duration
}

func loadConfig(args []string) (config, error) {
	cfg := config{
		Mode:             envOrDefault("SYNC_MODE", modeDaily),
		DryRun:           envBool("SYNC_DRY_RUN", true),
		CompetitionCode:  strings.TrimSpace(os.Getenv("SYNC_COMPETITION_CODE")),
		SupabaseURL:      strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/"),
		SupabaseKey:      firstNonEmpty("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
		FootballDataKey:  strings.TrimSpace(os.Getenv("FOOTBALL_DATA_TOKEN")),
		FootballDataURL:  strings.TrimRight(envOrDefault("FOOTBALL_DATA_BASE_URL", "https://api.football-data.org/v4"), "/"),
		APIFootballKey:   strings.TrimSpace(os.Getenv("API_FOOTBALL_KEY")),
		RequestTimeout:   60 * time.Second,
		ProviderInterval: 8 * time.Second,
	}

	flags := flag.NewFlagSet("palpita-sync", flag.ContinueOnError)
	flags.StringVar(&cfg.Mode, "mode", cfg.Mode, "sync mode: daily or matchday")
	flags.BoolVar(&cfg.DryRun, "dry-run", cfg.DryRun, "fetch and map data without writing to Supabase")
	flags.StringVar(&cfg.CompetitionCode, "competition", cfg.CompetitionCode, "competition code (PPL) or ALL for every active football-data competition")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}

	cfg.Mode = strings.ToLower(strings.TrimSpace(cfg.Mode))
	cfg.CompetitionCode = strings.ToUpper(strings.TrimSpace(cfg.CompetitionCode))
	if cfg.CompetitionCode == "ALL" {
		cfg.CompetitionCode = ""
	}

	var missing []string
	if cfg.SupabaseURL == "" {
		missing = append(missing, "SUPABASE_URL")
	}
	if cfg.SupabaseKey == "" {
		missing = append(missing, "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)")
	}
	if cfg.FootballDataKey == "" && cfg.APIFootballKey == "" {
		missing = append(missing, "API_FOOTBALL_KEY (or FOOTBALL_DATA_TOKEN)")
	}
	if len(missing) > 0 {
		return config{}, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	cfg.CompetitionCode = resolveCompetitionCode(cfg.CompetitionCode)

	if cfg.Mode != modeDaily && cfg.Mode != modeMatchday {
		return config{}, fmt.Errorf("invalid mode %q: expected %q or %q", cfg.Mode, modeDaily, modeMatchday)
	}
	if !strings.HasPrefix(cfg.SupabaseURL, "https://") {
		return config{}, errors.New("SUPABASE_URL must use https")
	}

	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func firstNonEmpty(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

// Legacy football-data codes → API-Football league ids (season start year separate).
var competitionCodeAliases = map[string]string{
	"PPL": "94",
	"PL":  "39",
	"BL1": "78",
	"SA":  "135",
	"PD":  "140",
	"FL1": "61",
	"ELC": "40",
	"DED": "88",
	"BSA": "71",
	"CL":  "2",
	"EL":  "3",
}

func resolveCompetitionCode(code string) string {
	if code == "" {
		return ""
	}
	if mapped, ok := competitionCodeAliases[code]; ok {
		return mapped
	}
	return code
}
