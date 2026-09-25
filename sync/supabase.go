package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type supabaseClient struct {
	baseURL    string
	key        string
	httpClient *http.Client
}

func newSupabaseClient(cfg config) *supabaseClient {
	return &supabaseClient{
		baseURL:    cfg.SupabaseURL + "/rest/v1",
		key:        cfg.SupabaseKey,
		httpClient: &http.Client{Timeout: cfg.RequestTimeout},
	}
}

func (c *supabaseClient) activeFootballDataCompetitions(
	ctx context.Context,
	onlyCode string,
) ([]competition, error) {
	return c.activeCompetitionsByProvider(ctx, "football-data", onlyCode)
}

func (c *supabaseClient) activeCompetitions(
	ctx context.Context,
	onlyCode string,
) ([]competition, error) {
	params := url.Values{}
	params.Set("select", "id,slug,name,season,external_provider,external_id")
	params.Set("is_active", "eq.true")
	params.Set("external_provider", "in.(football-data,api-football)")
	params.Set("order", "name.asc")
	if onlyCode != "" && onlyCode != "ALL" {
		params.Set("external_id", "eq."+onlyCode)
	}

	var rows []competition
	if err := c.requestJSON(ctx, http.MethodGet, "/competitions?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) activeCompetitionsByProvider(
	ctx context.Context,
	provider string,
	onlyCode string,
) ([]competition, error) {
	params := url.Values{}
	params.Set("select", "id,slug,name,season,external_provider,external_id")
	params.Set("is_active", "eq.true")
	params.Set("external_provider", "eq."+provider)
	params.Set("order", "name.asc")
	if onlyCode != "" && onlyCode != "ALL" {
		params.Set("external_id", "eq."+onlyCode)
	}

	var rows []competition
	if err := c.requestJSON(ctx, http.MethodGet, "/competitions?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) competitionIDsWithMatches(
	ctx context.Context,
	from timeRange,
) (map[string]bool, error) {
	params := url.Values{}
	params.Set("select", "competition_id")
	params.Set("kickoff_at", "gte."+from.Start)
	params.Add("kickoff_at", "lt."+from.End)

	var rows []struct {
		CompetitionID string `json:"competition_id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(rows))
	for _, row := range rows {
		result[row.CompetitionID] = true
	}
	return result, nil
}

// competitionIDsNeedingMatchdaySync returns competitions that are currently live
// or have a kickoff inside [Start, End) (typically now-3h .. now+20m).
func (c *supabaseClient) competitionIDsNeedingMatchdaySync(
	ctx context.Context,
	window timeRange,
) (map[string]bool, error) {
	result := make(map[string]bool)

	liveParams := url.Values{}
	liveParams.Set("select", "competition_id")
	liveParams.Set("status", "eq.live")
	var liveRows []struct {
		CompetitionID string `json:"competition_id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+liveParams.Encode(), nil, "", &liveRows); err != nil {
		return nil, err
	}
	for _, row := range liveRows {
		result[row.CompetitionID] = true
	}

	windowIDs, err := c.competitionIDsWithMatches(ctx, window)
	if err != nil {
		return nil, err
	}
	for id := range windowIDs {
		result[id] = true
	}
	return result, nil
}

func (c *supabaseClient) updateTeam(ctx context.Context, id string, row teamRow) error {
	params := url.Values{}
	params.Set("id", "eq."+id)
	row.ID = ""
	row.CompetitionID = ""
	row.CrestOverrideURL = nil // never write override from sync
	return c.requestJSON(
		ctx,
		http.MethodPatch,
		"/competition_teams?"+params.Encode(),
		row,
		"return=minimal",
		nil,
	)
}

type timeRange struct {
	Start string
	End   string
}

func (c *supabaseClient) teams(ctx context.Context, competitionID string) ([]teamRow, error) {
	params := url.Values{}
	params.Set("select", "id,competition_id,name,short_name,crest_url,crest_override_url,external_id")
	params.Set("competition_id", "eq."+competitionID)

	var rows []teamRow
	if err := c.requestJSON(ctx, http.MethodGet, "/competition_teams?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) insertTeam(ctx context.Context, row teamRow) (teamRow, error) {
	row.CrestOverrideURL = nil
	var rows []teamRow
	if err := c.requestJSON(
		ctx,
		http.MethodPost,
		"/competition_teams",
		row,
		"return=representation",
		&rows,
	); err != nil {
		return teamRow{}, err
	}
	if len(rows) != 1 {
		return teamRow{}, fmt.Errorf("Supabase returned %d rows after inserting a team", len(rows))
	}
	return rows[0], nil
}

func (c *supabaseClient) matches(ctx context.Context, competitionID string) ([]existingMatch, error) {
	params := url.Values{}
	params.Set(
		"select",
		"id,competition_id,phase,round_or_matchday,group_letter,home_team_id,away_team_id,"+
			"kickoff_at,status,home_score,away_score,et_home_score,et_away_score,"+
			"pen_home_score,pen_away_score,live_minute,external_id,manual_override,is_postponed,"+
			"tie_id,leg_kind",
	)
	params.Set("competition_id", "eq."+competitionID)

	var rows []existingMatch
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+params.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (c *supabaseClient) insertMatches(ctx context.Context, rows []matchRow) error {
	const chunkSize = 100
	for start := 0; start < len(rows); start += chunkSize {
		end := min(start+chunkSize, len(rows))
		if err := c.requestJSON(
			ctx,
			http.MethodPost,
			"/matches",
			rows[start:end],
			"return=minimal",
			nil,
		); err != nil {
			return err
		}
	}
	return nil
}

func (c *supabaseClient) updateMatch(ctx context.Context, id string, row matchRow) error {
	params := url.Values{}
	params.Set("id", "eq."+id)
	params.Set("manual_override", "eq.false")
	row.ID = ""
	return c.requestJSON(
		ctx,
		http.MethodPatch,
		"/matches?"+params.Encode(),
		row,
		"return=minimal",
		nil,
	)
}

func (c *supabaseClient) updateMatchTie(ctx context.Context, id string, tieID *string, legKind *string) error {
	params := url.Values{}
	params.Set("id", "eq."+id)
	params.Set("manual_override", "eq.false")
	payload := map[string]any{
		"tie_id":   tieID,
		"leg_kind": legKind,
	}
	return c.requestJSON(
		ctx,
		http.MethodPatch,
		"/matches?"+params.Encode(),
		payload,
		"return=minimal",
		nil,
	)
}

// rebuildMatchdaySessions calls public.rebuild_matchday_sessions (Azores clusters).
// pAzoresDate empty → today+tomorrow in Atlantic/Azores (RPC default).
func (c *supabaseClient) rebuildMatchdaySessions(ctx context.Context, pAzoresDate string) (int, error) {
	payload := map[string]any{}
	if pAzoresDate != "" {
		payload["p_azores_date"] = pAzoresDate
	} else {
		payload["p_azores_date"] = nil
	}
	var result int
	if err := c.requestJSON(
		ctx,
		http.MethodPost,
		"/rpc/rebuild_matchday_sessions",
		payload,
		"",
		&result,
	); err != nil {
		return 0, err
	}
	return result, nil
}

// competitionIDsFromActiveMatchdaySessions returns competitions for open sessions
// (status active, or planned with poll_start already reached). Falls back to empty
// map (caller uses time window) when the table is missing or empty.
func (c *supabaseClient) competitionIDsFromActiveMatchdaySessions(
	ctx context.Context,
) (map[string]bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	params := url.Values{}
	params.Set("select", "match_ids,status,poll_start")
	params.Set("status", "in.(planned,active)")
	params.Set("poll_start", "lte."+now)

	var sessions []struct {
		MatchIDs  []string `json:"match_ids"`
		Status    string   `json:"status"`
		PollStart string   `json:"poll_start"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/sync_matchday_sessions?"+params.Encode(), nil, "", &sessions); err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return map[string]bool{}, nil
	}

	idSet := make(map[string]struct{})
	for _, s := range sessions {
		for _, id := range s.MatchIDs {
			idSet[id] = struct{}{}
		}
	}
	if len(idSet) == 0 {
		return map[string]bool{}, nil
	}

	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}

	mParams := url.Values{}
	mParams.Set("select", "competition_id")
	mParams.Set("id", "in.("+strings.Join(ids, ",")+")")
	var rows []struct {
		CompetitionID string `json:"competition_id"`
	}
	if err := c.requestJSON(ctx, http.MethodGet, "/matches?"+mParams.Encode(), nil, "", &rows); err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(rows))
	for _, row := range rows {
		result[row.CompetitionID] = true
	}
	return result, nil
}

func (c *supabaseClient) requestJSON(
	ctx context.Context,
	method string,
	path string,
	payload any,
	prefer string,
	target any,
) error {
	var encoded []byte
	if payload != nil {
		var err error
		encoded, err = json.Marshal(payload)
		if err != nil {
			return err
		}
	}

	const maxAttempts = 4
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}

		var body io.Reader
		if encoded != nil {
			body = bytes.NewReader(encoded)
		}

		request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
		if err != nil {
			return err
		}
		request.Header.Set("apikey", c.key)
		// New sb_secret_* keys are sent only through apikey. Legacy service-role JWTs
		// still require the Bearer header.
		if !strings.HasPrefix(c.key, "sb_secret_") {
			request.Header.Set("Authorization", "Bearer "+c.key)
		}
		request.Header.Set("Accept", "application/json")
		if encoded != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		if prefer != "" {
			request.Header.Set("Prefer", prefer)
		}

		response, err := c.httpClient.Do(request)
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

		responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 16<<20))
		_ = response.Body.Close()
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

		if response.StatusCode < 200 || response.StatusCode >= 300 {
			lastErr = fmt.Errorf(
				"Supabase request failed: method=%s path=%s status=%s body=%s",
				method,
				path,
				response.Status,
				strings.TrimSpace(string(responseBody)),
			)
			if attempt < maxAttempts && isTransientHTTPStatus(response.StatusCode) {
				if sleepErr := sleepBackoff(ctx, attempt); sleepErr != nil {
					return sleepErr
				}
				continue
			}
			return lastErr
		}

		if target != nil && len(responseBody) > 0 {
			if err := json.Unmarshal(responseBody, target); err != nil {
				return fmt.Errorf("Supabase returned invalid JSON: %w", err)
			}
		}
		return nil
	}
	return lastErr
}

func sleepBackoff(ctx context.Context, attempt int) error {
	// 1s, 2s, 4s
	d := time.Duration(1<<(attempt-1)) * time.Second
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isTransientNetError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "temporary failure") ||
		strings.Contains(msg, "tls handshake timeout") ||
		strings.Contains(msg, "i/o timeout") ||
		strings.Contains(msg, "eof")
}

func isTransientHTTPStatus(code int) bool {
	return code == http.StatusRequestTimeout ||
		code == http.StatusTooManyRequests ||
		code == http.StatusBadGateway ||
		code == http.StatusServiceUnavailable ||
		code == http.StatusGatewayTimeout
}
