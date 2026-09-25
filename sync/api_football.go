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
	"time"
)

// Minimal API-Football (api-sports.io) client.
// Pro plan (~7500 req/day) is the primary provider for active leagues.

type apiFootballClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	interval   time.Duration
	lastCall   time.Time
}

type afTeam struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
	Logo string `json:"logo"`
}

type afFixture struct {
	Fixture struct {
		ID     int    `json:"id"`
		Date   string `json:"date"`
		Status struct {
			Short string `json:"short"`
			Elapsed *int `json:"elapsed"`
		} `json:"status"`
	} `json:"fixture"`
	League struct {
		Round string `json:"round"`
	} `json:"league"`
	Teams struct {
		Home afTeam `json:"home"`
		Away afTeam `json:"away"`
	} `json:"teams"`
	Goals struct {
		Home *int `json:"home"`
		Away *int `json:"away"`
	} `json:"goals"`
	Score struct {
		Fulltime struct {
			Home *int `json:"home"`
			Away *int `json:"away"`
		} `json:"fulltime"`
		Extratime struct {
			Home *int `json:"home"`
			Away *int `json:"away"`
		} `json:"extratime"`
		Penalty struct {
			Home *int `json:"home"`
			Away *int `json:"away"`
		} `json:"penalty"`
	} `json:"score"`
}

func newAPIFootballClient(cfg config) *apiFootballClient {
	key := strings.TrimSpace(cfg.APIFootballKey)
	if key == "" {
		return nil
	}
	return &apiFootballClient{
		baseURL: strings.TrimRight(envOrDefault("API_FOOTBALL_BASE_URL", "https://v3.football.api-sports.io"), "/"),
		apiKey:  key,
		httpClient: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
		// Pro plan: stay polite under rate limits (~300–500ms between calls).
		interval: 400 * time.Millisecond,
	}
}

func (c *apiFootballClient) throttle(ctx context.Context) error {
	if c == nil {
		return fmt.Errorf("API-Football client not configured (set API_FOOTBALL_KEY)")
	}
	wait := c.interval - time.Since(c.lastCall)
	if wait > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
	c.lastCall = time.Now()
	return nil
}

func (c *apiFootballClient) get(ctx context.Context, path string, query url.Values, dest any) error {
	const maxAttempts = 4
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := c.throttle(ctx); err != nil {
			return err
		}
		u := c.baseURL + path
		if len(query) > 0 {
			u += "?" + query.Encode()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return err
		}
		req.Header.Set("x-apisports-key", c.apiKey)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt < maxAttempts && isTransientNetError(err) {
				if sleepErr := sleepBackoff(ctx, attempt); sleepErr != nil {
					return sleepErr
				}
				continue
			}
			return err
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			if attempt < maxAttempts && isTransientNetError(readErr) {
				if sleepErr := sleepBackoff(ctx, attempt); sleepErr != nil {
					return sleepErr
				}
				continue
			}
			return readErr
		}
		if isTransientHTTPStatus(resp.StatusCode) || resp.StatusCode == 499 {
			lastErr = fmt.Errorf("api-football %s: HTTP %d: %s", path, resp.StatusCode, truncate(string(body), 200))
			if attempt < maxAttempts {
				if sleepErr := sleepBackoff(ctx, attempt); sleepErr != nil {
					return sleepErr
				}
				continue
			}
			return lastErr
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("api-football %s: HTTP %d: %s", path, resp.StatusCode, truncate(string(body), 200))
		}
		var envelope struct {
			Response json.RawMessage `json:"response"`
			Errors   any             `json:"errors"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			return err
		}
		if rateLimited(envelope.Errors) {
			lastErr = fmt.Errorf("api-football %s: HTTP 429: rate limit", path)
			if attempt < maxAttempts {
				if sleepErr := sleepBackoff(ctx, attempt); sleepErr != nil {
					return sleepErr
				}
				continue
			}
			return lastErr
		}
		return json.Unmarshal(envelope.Response, dest)
	}
	return lastErr
}

func rateLimited(errors any) bool {
	if errors == nil {
		return false
	}
	s := strings.ToLower(fmt.Sprint(errors))
	return strings.Contains(s, "ratelimit") || strings.Contains(s, "rate limit") || strings.Contains(s, "too many requests")
}

func (c *apiFootballClient) teams(ctx context.Context, leagueID, season int) ([]afTeam, error) {
	q := url.Values{}
	q.Set("league", strconv.Itoa(leagueID))
	q.Set("season", strconv.Itoa(season))
	var rows []struct {
		Team afTeam `json:"team"`
	}
	if err := c.get(ctx, "/teams", q, &rows); err != nil {
		return nil, err
	}
	out := make([]afTeam, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Team)
	}
	return out, nil
}

func (c *apiFootballClient) fixtures(ctx context.Context, leagueID, season int) ([]afFixture, error) {
	q := url.Values{}
	q.Set("league", strconv.Itoa(leagueID))
	q.Set("season", strconv.Itoa(season))
	var rows []afFixture
	if err := c.get(ctx, "/fixtures", q, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func afTeamsToFD(teams []afTeam) []fdTeam {
	out := make([]fdTeam, 0, len(teams))
	for _, t := range teams {
		out = append(out, fdTeam{
			ID:        t.ID,
			Name:      t.Name,
			ShortName: t.Code,
			TLA:       t.Code,
			Crest:     t.Logo,
		})
	}
	return out
}

func afFixturesToFD(fixtures []afFixture) []fdMatch {
	out := make([]fdMatch, 0, len(fixtures))
	for _, f := range fixtures {
		m := fdMatch{
			ID:      f.Fixture.ID,
			UTCDate: f.Fixture.Date,
			Status:  f.Fixture.Status.Short, // mapped later via mapFDStatus
			Minute:  f.Fixture.Status.Elapsed,
			HomeTeam: fdTeam{
				ID: f.Teams.Home.ID, Name: f.Teams.Home.Name,
				ShortName: f.Teams.Home.Code, TLA: f.Teams.Home.Code, Crest: f.Teams.Home.Logo,
			},
			AwayTeam: fdTeam{
				ID: f.Teams.Away.ID, Name: f.Teams.Away.Name,
				ShortName: f.Teams.Away.Code, TLA: f.Teams.Away.Code, Crest: f.Teams.Away.Logo,
			},
		}
		// Prefer score.fulltime as 90'. goals can include ET after AET/PEN.
		m.Score.RegularTime.Home = f.Score.Fulltime.Home
		m.Score.RegularTime.Away = f.Score.Fulltime.Away
		if m.Score.RegularTime.Home == nil || m.Score.RegularTime.Away == nil {
			// Fallback only when fulltime is missing (typical during 90' live).
			m.Score.RegularTime.Home = f.Goals.Home
			m.Score.RegularTime.Away = f.Goals.Away
		}
		m.Score.FullTime.Home = f.Goals.Home
		m.Score.FullTime.Away = f.Goals.Away
		// Store 120' accumulated when present; else leave nil.
		m.Score.ExtraTime.Home = f.Score.Extratime.Home
		m.Score.ExtraTime.Away = f.Score.Extratime.Away
		m.Score.Penalties.Home = f.Score.Penalty.Home
		m.Score.Penalties.Away = f.Score.Penalty.Away
		if md := parseAFRound(f.League.Round); md != nil {
			m.Matchday = md
		}
		m.Stage = f.League.Round
		out = append(out, m)
	}
	return out
}

func parseAFRound(round string) *int {
	// e.g. "Regular Season - 12"
	parts := strings.Split(round, "-")
	if len(parts) == 0 {
		return nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(parts[len(parts)-1]))
	if err != nil {
		return nil
	}
	return &n
}
