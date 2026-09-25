package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type footballDataClient struct {
	baseURL     string
	token       string
	httpClient  *http.Client
	minInterval time.Duration
	mu          sync.Mutex
	lastRequest time.Time
}

type fdTeam struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	ShortName string `json:"shortName"`
	TLA       string `json:"tla"`
	Crest     string `json:"crest"`
}

type fdTeamsResponse struct {
	Teams []fdTeam `json:"teams"`
}

type fdScorePair struct {
	Home *int `json:"home"`
	Away *int `json:"away"`
}

type fdMatch struct {
	ID         int     `json:"id"`
	UTCDate    string  `json:"utcDate"`
	Status     string  `json:"status"`
	Matchday   *int    `json:"matchday"`
	Stage      string  `json:"stage"`
	Group      *string `json:"group"`
	Minute     *int    `json:"minute"`
	HomeTeam   fdTeam  `json:"homeTeam"`
	AwayTeam   fdTeam  `json:"awayTeam"`
	Score      struct {
		FullTime    fdScorePair `json:"fullTime"`
		RegularTime fdScorePair `json:"regularTime"`
		ExtraTime   fdScorePair `json:"extraTime"`
		Penalties   fdScorePair `json:"penalties"`
	} `json:"score"`
}

type fdMatchesResponse struct {
	Matches []fdMatch `json:"matches"`
}

func newFootballDataClient(cfg config) *footballDataClient {
	return &footballDataClient{
		baseURL:     cfg.FootballDataURL,
		token:       cfg.FootballDataKey,
		httpClient:  &http.Client{Timeout: cfg.RequestTimeout},
		minInterval: cfg.ProviderInterval,
	}
}

func (c *footballDataClient) teams(ctx context.Context, code string, season int) ([]fdTeam, error) {
	var response fdTeamsResponse
	path := "/competitions/" + url.PathEscape(code) + "/teams?season=" + strconv.Itoa(season)
	if err := c.getJSON(ctx, path, &response); err != nil {
		return nil, err
	}
	return response.Teams, nil
}

func (c *footballDataClient) matches(
	ctx context.Context,
	code string,
	season int,
	dateFrom *time.Time,
	dateTo *time.Time,
) ([]fdMatch, error) {
	params := url.Values{}
	params.Set("season", strconv.Itoa(season))
	if dateFrom != nil && dateTo != nil {
		params.Set("dateFrom", dateFrom.UTC().Format(time.DateOnly))
		params.Set("dateTo", dateTo.UTC().Format(time.DateOnly))
	}

	var response fdMatchesResponse
	path := "/competitions/" + url.PathEscape(code) + "/matches?" + params.Encode()
	if err := c.getJSON(ctx, path, &response); err != nil {
		return nil, err
	}
	return response.Matches, nil
}

func (c *footballDataClient) getJSON(ctx context.Context, path string, target any) error {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := c.waitForRateLimit(ctx); err != nil {
			return err
		}

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
		if err != nil {
			return err
		}
		request.Header.Set("X-Auth-Token", c.token)
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "Palpita-Sync/1.0")

		response, err := c.httpClient.Do(request)
		if err != nil {
			lastErr = err
			continue
		}

		body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		response.Body.Close()
		if readErr != nil {
			return readErr
		}

		if response.StatusCode >= 200 && response.StatusCode < 300 {
			if err := json.Unmarshal(body, target); err != nil {
				return fmt.Errorf("football-data returned invalid JSON: %w", err)
			}
			return nil
		}

		lastErr = fmt.Errorf(
			"football-data request failed: status=%s body=%s",
			response.Status,
			strings.TrimSpace(string(body)),
		)
		if response.StatusCode != http.StatusTooManyRequests && response.StatusCode < 500 {
			return lastErr
		}

		delay := time.Duration(attempt) * 5 * time.Second
		if retryAfter, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && retryAfter > 0 {
			delay = time.Duration(retryAfter) * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}

func (c *footballDataClient) waitForRateLimit(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if wait := c.minInterval - time.Since(c.lastRequest); wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	c.lastRequest = time.Now()
	return nil
}

func mapFDStatus(status string) string {
	switch strings.ToUpper(status) {
	case "IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT",
		"LIVE", "1H", "2H", "HT", "ET", "BT", "P", "INT":
		return "live"
	case "FINISHED", "AWARDED", "FT", "AET", "PEN":
		return "finished"
	default:
		return "scheduled"
	}
}

// isProviderPostponedStatus reports API statuses that mean the fixture was postponed.
func isProviderPostponedStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PST", "POSTPONED", "PPD":
		return true
	default:
		return false
	}
}

func mapFDPhase(stage string) *string {
	var phase string
	switch strings.ToUpper(stage) {
	case "REGULAR_SEASON":
		phase = "regular"
	case "LEAGUE_STAGE":
		phase = "league_phase"
	case "GROUP_STAGE":
		phase = "groups"
	case "LAST_16":
		phase = "round_of_16"
	case "QUARTER_FINALS":
		phase = "quarter_finals"
	case "SEMI_FINALS":
		phase = "semi_finals"
	case "THIRD_PLACE":
		phase = "third_place"
	case "FINAL":
		phase = "final"
	default:
		if stage == "" {
			return nil
		}
		phase = strings.ToLower(stage)
	}
	return &phase
}

func mapFDGroup(group *string) *string {
	if group == nil {
		return nil
	}
	value := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(*group)), "GROUP_")
	return stringPointer(value)
}
