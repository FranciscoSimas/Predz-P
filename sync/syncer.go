package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

type syncService struct {
	cfg         config
	supabase    *supabaseClient
	provider    *footballDataClient
	apiFootball *apiFootballClient
	logger      *slog.Logger
	now         func() time.Time
}

type syncStats struct {
	TeamsCreated         int
	TeamsUpdated         int
	TeamsUnchanged       int
	MatchesCreated       int
	MatchesUpdated       int
	MatchesUnchanged     int
	MatchesManualSkipped int
	MatchesUnresolved    int
}

func newSyncService(cfg config, logger *slog.Logger) *syncService {
	return &syncService{
		cfg:         cfg,
		supabase:    newSupabaseClient(cfg),
		provider:    newFootballDataClient(cfg),
		apiFootball: newAPIFootballClient(cfg),
		logger:      logger,
		now:         time.Now,
	}
}

func (s *syncService) run(ctx context.Context) error {
	competitions, err := s.supabase.activeCompetitions(ctx, s.cfg.CompetitionCode)
	if err != nil {
		return fmt.Errorf("load active competitions: %w", err)
	}
	if len(competitions) == 0 {
		return fmt.Errorf(
			"no active competitions found%s",
			optionalCodeMessage(s.cfg.CompetitionCode),
		)
	}

	if s.cfg.Mode == modeMatchday {
		competitions, err = s.filterMatchdayCompetitions(ctx, competitions)
		if err != nil {
			return err
		}
		if len(competitions) == 0 {
			s.logger.Info("no competitions have matches in the current UTC matchday window")
			return nil
		}
	}

	s.logger.Info(
		"sync started",
		"mode", s.cfg.Mode,
		"dry_run", s.cfg.DryRun,
		"competitions", len(competitions),
	)

	var failed []string
	succeeded := 0
	for _, comp := range competitions {
		if comp.ExternalProvider == "api-football" && s.apiFootball == nil {
			s.logger.Warn(
				"skipping api-football competition (API_FOOTBALL_KEY not set)",
				"competition", comp.Name,
				"code", comp.ExternalID,
			)
			continue
		}
		if comp.ExternalProvider != "api-football" && strings.TrimSpace(s.cfg.FootballDataKey) == "" {
			s.logger.Warn(
				"skipping football-data competition (FOOTBALL_DATA_TOKEN not set)",
				"competition", comp.Name,
				"code", comp.ExternalID,
			)
			continue
		}
		stats, err := s.syncCompetition(ctx, comp)
		if err != nil {
			// Season not published yet (e.g. CL 26/27) — skip, don't fail the whole run.
			if isProviderUnavailable(err) {
				s.logger.Warn(
					"skipping competition (provider has no data for this season yet)",
					"competition", comp.Name,
					"provider", comp.ExternalProvider,
					"code", comp.ExternalID,
					"season", comp.Season,
					"error", err.Error(),
				)
				continue
			}
			// Daily ALL: one flaky league (timeouts/429) must not abort the rest
			// or turn the GitHub cron red (that emails "All jobs have failed").
			if s.cfg.Mode == modeDaily {
				s.logger.Error(
					"competition sync failed; continuing with remaining competitions",
					"competition", comp.Name,
					"code", comp.ExternalID,
					"error", err.Error(),
				)
				failed = append(failed, fmt.Sprintf("%s (%s)", comp.Name, comp.ExternalID))
				if ctx.Err() != nil {
					break
				}
				continue
			}
			return fmt.Errorf("sync %s (%s): %w", comp.Name, comp.ExternalID, err)
		}
		succeeded++
		s.logger.Info(
			"competition sync complete",
			"competition", comp.Name,
			"provider", comp.ExternalProvider,
			"code", comp.ExternalID,
			"season", comp.Season,
			"teams_created", stats.TeamsCreated,
			"teams_updated", stats.TeamsUpdated,
			"teams_unchanged", stats.TeamsUnchanged,
			"matches_created", stats.MatchesCreated,
			"matches_updated", stats.MatchesUpdated,
			"matches_unchanged", stats.MatchesUnchanged,
			"manual_overrides_skipped", stats.MatchesManualSkipped,
			"unresolved_matches", stats.MatchesUnresolved,
		)
	}

	if s.cfg.Mode == modeDaily && !s.cfg.DryRun {
		n, err := s.supabase.rebuildMatchdaySessions(ctx, "")
		if err != nil {
			s.logger.Warn("rebuild_matchday_sessions failed", "error", err.Error())
		} else {
			s.logger.Info("rebuild_matchday_sessions ok", "sessions_touched", n)
		}
	}
	if len(failed) > 0 {
		s.logger.Error(
			"daily sync finished with competition failures",
			"failed_count", len(failed),
			"succeeded", succeeded,
			"failed", strings.Join(failed, "; "),
		)
		if succeeded == 0 {
			return fmt.Errorf(
				"daily sync finished with %d competition failure(s): %s",
				len(failed),
				strings.Join(failed, "; "),
			)
		}
	}
	return nil
}

func isProviderUnavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "status=404") ||
		strings.Contains(msg, "http 404") ||
		strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "resource you are looking for")
}

func (s *syncService) filterMatchdayCompetitions(
	ctx context.Context,
	competitions []competition,
) ([]competition, error) {
	// Prefer competitions tied to an active Azores matchday session; fall back to
	// the live / now-3h .. now+20m window if sessions are empty or unavailable.
	ids, err := s.supabase.competitionIDsFromActiveMatchdaySessions(ctx)
	if err != nil {
		s.logger.Warn(
			"active matchday sessions unavailable; falling back to time window",
			"error", err.Error(),
		)
		ids = nil
	}
	now := s.now().UTC()
	start := now.Add(-3 * time.Hour)
	end := now.Add(20 * time.Minute)
	if len(ids) == 0 {
		ids, err = s.supabase.competitionIDsNeedingMatchdaySync(ctx, timeRange{
			Start: start.Format(time.RFC3339),
			End:   end.Format(time.RFC3339),
		})
		if err != nil {
			return nil, fmt.Errorf("find matchday competitions: %w", err)
		}
	}

	filtered := make([]competition, 0, len(competitions))
	for _, comp := range competitions {
		if ids[comp.ID] {
			filtered = append(filtered, comp)
		}
	}
	if len(filtered) == 0 {
		s.logger.Info(
			"matchday preflight: no competitions in active window",
			"window_start", start.Format(time.RFC3339),
			"window_end", end.Format(time.RFC3339),
		)
	}
	return filtered, nil
}

func (s *syncService) syncCompetition(ctx context.Context, comp competition) (syncStats, error) {
	var stats syncStats
	season, err := seasonStartYear(comp.Season)
	if err != nil {
		return stats, err
	}

	existingTeams, err := s.supabase.teams(ctx, comp.ID)
	if err != nil {
		return stats, fmt.Errorf("load teams: %w", err)
	}

	var providerTeams []fdTeam
	var providerMatches []fdMatch

	switch comp.ExternalProvider {
	case "api-football":
		leagueID, err := strconv.Atoi(comp.ExternalID)
		if err != nil {
			return stats, fmt.Errorf("api-football league id %q: %w", comp.ExternalID, err)
		}
		if s.cfg.Mode == modeDaily {
			afTeams, err := s.apiFootball.teams(ctx, leagueID, season)
			if err != nil {
				return stats, fmt.Errorf("fetch api-football teams: %w", err)
			}
			providerTeams = afTeamsToFD(afTeams)
		}
		afFixtures, err := s.apiFootball.fixtures(ctx, leagueID, season)
		if err != nil {
			return stats, fmt.Errorf("fetch api-football fixtures: %w", err)
		}
		providerMatches = afFixturesToFD(afFixtures)
		if s.cfg.Mode == modeMatchday {
			// Keep only fixtures near the active window (saves API calls).
			day := s.now().UTC()
			from := day.Add(-3 * time.Hour)
			to := day.Add(24 * time.Hour)
			providerMatches = filterFDMatchesByKickoff(providerMatches, from, to)
			providerTeams = teamsFromMatches(providerMatches)
		}
	default:
		if s.cfg.Mode == modeDaily {
			providerTeams, err = s.provider.teams(ctx, comp.ExternalID, season)
			if err != nil {
				return stats, fmt.Errorf("fetch provider teams: %w", err)
			}
		}
		var dateFrom, dateTo *time.Time
		if s.cfg.Mode == modeMatchday {
			day := s.now().UTC().Truncate(24 * time.Hour)
			from := day.Add(-24 * time.Hour)
			to := day.Add(24 * time.Hour)
			dateFrom, dateTo = &from, &to
		}
		providerMatches, err = s.provider.matches(ctx, comp.ExternalID, season, dateFrom, dateTo)
		if err != nil {
			return stats, fmt.Errorf("fetch provider matches: %w", err)
		}
		if s.cfg.Mode == modeMatchday {
			providerTeams = teamsFromMatches(providerMatches)
		}
	}

	teamIDs, teamStats, err := s.syncTeams(ctx, comp, existingTeams, providerTeams)
	if err != nil {
		return stats, err
	}
	stats.TeamsCreated += teamStats.TeamsCreated
	stats.TeamsUpdated += teamStats.TeamsUpdated
	stats.TeamsUnchanged += teamStats.TeamsUnchanged

	matchStats, err := s.syncMatches(ctx, comp, teamIDs, providerMatches)
	if err != nil {
		return stats, err
	}
	stats.MatchesCreated += matchStats.MatchesCreated
	stats.MatchesUpdated += matchStats.MatchesUpdated
	stats.MatchesUnchanged += matchStats.MatchesUnchanged
	stats.MatchesManualSkipped += matchStats.MatchesManualSkipped
	stats.MatchesUnresolved += matchStats.MatchesUnresolved

	if s.cfg.Mode == modeDaily {
		if err := s.syncSpecialsDaily(ctx, comp, teamIDs); err != nil {
			s.logger.Warn("specials daily sync failed", "competition", comp.Name, "error", err.Error())
		}
	}
	if s.cfg.Mode == modeMatchday {
		if err := s.syncSpecialsMatchday(ctx, comp, teamIDs, providerMatches); err != nil {
			s.logger.Warn("specials matchday sync failed", "competition", comp.Name, "error", err.Error())
		}
	}

	return stats, nil
}

func (s *syncService) syncTeams(
	ctx context.Context,
	comp competition,
	existing []teamRow,
	providerTeams []fdTeam,
) (map[string]string, syncStats, error) {
	var stats syncStats
	byExternal := make(map[string]teamRow)
	byName := make(map[string]teamRow)
	byShortName := make(map[string]teamRow)
	for _, row := range existing {
		if row.ExternalID != nil {
			byExternal[*row.ExternalID] = row
		}
		if key := canonicalClubName(row.Name); key != "" {
			byName[key] = row
		}
		if row.ShortName != nil {
			byShortName[strings.ToUpper(*row.ShortName)] = row
		}
	}

	sort.Slice(providerTeams, func(i, j int) bool { return providerTeams[i].ID < providerTeams[j].ID })
	result := make(map[string]string, len(providerTeams))
	for _, providerTeam := range providerTeams {
		if providerTeam.ID == 0 {
			continue
		}
		externalID := providerExternalID(comp.ExternalProvider, providerTeam.ID)
		desired := teamRow{
			CompetitionID: comp.ID,
			Name:          providerTeam.Name,
			ShortName:     stringPointer(firstValue(providerTeam.TLA, providerTeam.ShortName)),
			CrestURL:      stringPointer(providerTeam.Crest),
			ExternalID:    &externalID,
		}

		current, found := byExternal[externalID]
		if !found {
			current, found = byName[canonicalClubName(providerTeam.Name)]
		}
		// TLA/short codes are not unique in API-Football (e.g. COR = Corinthians
		// and Coritiba; ATL = Atlético-MG and Athletico-PR). Only use them to
		// remap legacy football-data rows (fd-*) or teams with no external_id.
		if !found && providerTeam.TLA != "" {
			if candidate, ok := byShortName[strings.ToUpper(providerTeam.TLA)]; ok && isLegacyTeamExternalID(candidate.ExternalID) {
				current, found = candidate, true
			}
		}

		if !found {
			stats.TeamsCreated++
			if s.cfg.DryRun {
				s.logger.Info("dry-run: would create team", "competition", comp.Name, "team", providerTeam.Name)
				// A synthetic ID lets the dry-run continue mapping matches without
				// pretending that a database row was actually created.
				result[externalID] = "dry-run-" + externalID
				continue
			}
			created, err := s.supabase.insertTeam(ctx, desired)
			if err != nil {
				return nil, stats, fmt.Errorf("insert team %s: %w", providerTeam.Name, err)
			}
			result[externalID] = created.ID
			continue
		}

		result[externalID] = current.ID
		// Preserve manual crest overrides — do not let the provider overwrite them.
		if current.hasCrestOverride() {
			desired.CrestURL = current.CrestURL
		}
		if teamsEqual(current, desired) {
			stats.TeamsUnchanged++
			continue
		}
		stats.TeamsUpdated++
		if s.cfg.DryRun {
			s.logger.Info("dry-run: would update team", "competition", comp.Name, "team", providerTeam.Name)
			continue
		}
		if err := s.supabase.updateTeam(ctx, current.ID, desired); err != nil {
			return nil, stats, fmt.Errorf("update team %s: %w", providerTeam.Name, err)
		}
	}
	return result, stats, nil
}

func (s *syncService) syncMatches(
	ctx context.Context,
	comp competition,
	teamIDs map[string]string,
	providerMatches []fdMatch,
) (syncStats, error) {
	var stats syncStats
	existingRows, err := s.supabase.matches(ctx, comp.ID)
	if err != nil {
		return stats, fmt.Errorf("load matches: %w", err)
	}
	existingByExternal := make(map[string]existingMatch, len(existingRows))
	unmanagedRows := 0
	usedIDs := make(map[string]bool, len(existingRows))
	for _, row := range existingRows {
		if strings.TrimSpace(row.ExternalID) == "" {
			unmanagedRows++
			continue
		}
		existingByExternal[row.ExternalID] = row
	}
	if unmanagedRows > 0 {
		s.logger.Warn(
			"competition contains placeholder matches without external_id",
			"competition", comp.Name,
			"count", unmanagedRows,
		)
		if !s.cfg.DryRun {
			return stats, fmt.Errorf(
				"refusing to import alongside %d placeholder matches without external_id; clean them up after validating a dry-run",
				unmanagedRows,
			)
		}
	}

	toCreate := make([]matchRow, 0)
	remapped := 0
	for _, providerMatch := range providerMatches {
		row, ok, err := mapFDMatch(comp, teamIDs, providerMatch)
		if err != nil {
			return stats, err
		}
		if !ok {
			stats.MatchesUnresolved++
			s.logger.Warn(
				"match skipped because a team is unresolved",
				"external_match_id", providerMatch.ID,
				"home_team", providerMatch.HomeTeam.Name,
				"away_team", providerMatch.AwayTeam.Name,
			)
			continue
		}

		current, found := existingByExternal[row.ExternalID]
		if found && usedIDs[current.ID] {
			found = false
		}
		if !found {
			current, found = findMatchForRemap(existingRows, row, usedIDs)
			if found {
				remapped++
				s.logger.Info(
					"remapped match by identity",
					"competition", comp.Name,
					"from_external_id", current.ExternalID,
					"to_external_id", row.ExternalID,
				)
			}
		}
		if !found {
			stats.MatchesCreated++
			toCreate = append(toCreate, row)
			continue
		}
		usedIDs[current.ID] = true
		if current.ManualOverride {
			stats.MatchesManualSkipped++
			continue
		}
		// Keep postponed through reschedule (NS + new date); clear only when finished.
		if current.IsPostponed && row.Status != "finished" {
			row.IsPostponed = true
		}
		if row.Status == "finished" {
			row.IsPostponed = false
		}
		if matchesEqual(current, row) {
			stats.MatchesUnchanged++
			continue
		}

		stats.MatchesUpdated++
		if s.cfg.DryRun {
			continue
		}
		// Do not overwrite tie_id / leg_kind here — assignKnockoutTies owns those.
		patch := row
		patch.TieID = nil
		patch.LegKind = nil
		if err := s.supabase.updateMatch(ctx, current.ID, patch); err != nil {
			s.logger.Error(
				"update match failed; continuing with remaining matches",
				"competition", comp.Name,
				"external_id", row.ExternalID,
				"match_id", current.ID,
				"error", err.Error(),
			)
			stats.MatchesUpdated--
			continue
		}
	}
	if remapped > 0 {
		s.logger.Info("match external_id remaps", "competition", comp.Name, "count", remapped)
	}

	if s.cfg.DryRun {
		if len(toCreate) > 0 {
			s.logger.Info("dry-run: would create matches", "competition", comp.Name, "count", len(toCreate))
		}
		return stats, nil
	}
	if err := s.supabase.insertMatches(ctx, toCreate); err != nil {
		return stats, fmt.Errorf("insert matches: %w", err)
	}
	if err := s.assignKnockoutTies(ctx, comp); err != nil {
		return stats, fmt.Errorf("assign knockout ties: %w", err)
	}
	return stats, nil
}

// assignKnockoutTies pairs two-legged knockout fixtures (same phase, swapped
// home/away) with a shared tie_id and leg_kind first/second by kickoff.
// Unpaired knockout legs stay single / final_single. League phases stay null.
func (s *syncService) assignKnockoutTies(ctx context.Context, comp competition) error {
	rows, err := s.supabase.matches(ctx, comp.ID)
	if err != nil {
		return err
	}
	desired := planKnockoutTies(rows)
	updated := 0
	for _, row := range rows {
		want, ok := desired[row.ID]
		if !ok {
			continue
		}
		if equalStringPointers(row.TieID, want.tieID) && equalStringPointers(row.LegKind, want.legKind) {
			continue
		}
		if s.cfg.DryRun {
			updated++
			continue
		}
		if err := s.supabase.updateMatchTie(ctx, row.ID, want.tieID, want.legKind); err != nil {
			return fmt.Errorf("update tie for match %s: %w", row.ID, err)
		}
		updated++
	}
	if updated > 0 {
		s.logger.Info("knockout ties assigned", "competition", comp.Name, "updated", updated)
	}
	return nil
}

type plannedTie struct {
	tieID   *string
	legKind *string
}

func planKnockoutTies(rows []existingMatch) map[string]plannedTie {
	out := make(map[string]plannedTie)
	byPhase := make(map[string][]existingMatch)
	for _, row := range rows {
		if row.HomeTeamID == nil || row.AwayTeamID == nil {
			continue
		}
		phase := ""
		if row.Phase != nil {
			phase = strings.TrimSpace(*row.Phase)
		}
		if !isKnockoutishPhase(phase) {
			// Clear stale knockout metadata on league/group matches.
			if row.TieID != nil || row.LegKind != nil {
				out[row.ID] = plannedTie{tieID: nil, legKind: nil}
			}
			continue
		}
		byPhase[strings.ToLower(phase)] = append(byPhase[strings.ToLower(phase)], row)
	}

	for phase, phaseRows := range byPhase {
		groups := make(map[string][]existingMatch)
		for _, row := range phaseRows {
			key := unorderedTeamPairKey(*row.HomeTeamID, *row.AwayTeamID)
			groups[key] = append(groups[key], row)
		}
		for _, group := range groups {
			sort.Slice(group, func(i, j int) bool {
				ti, ei := time.Parse(time.RFC3339, group[i].KickoffAt)
				tj, ej := time.Parse(time.RFC3339, group[j].KickoffAt)
				if ei != nil || ej != nil {
					return group[i].KickoffAt < group[j].KickoffAt
				}
				if !ti.Equal(tj) {
					return ti.Before(tj)
				}
				return group[i].ID < group[j].ID
			})
			if len(group) == 2 && teamsAreReturnLegs(group[0], group[1]) {
				tieID := reuseOrNewTieID(group[0].TieID, group[1].TieID)
				first, second := "first", "second"
				out[group[0].ID] = plannedTie{tieID: &tieID, legKind: &first}
				out[group[1].ID] = plannedTie{tieID: &tieID, legKind: &second}
				continue
			}
			for _, row := range group {
				kind := "single"
				if isFinalPhase(phase) {
					kind = "final_single"
				}
				out[row.ID] = plannedTie{tieID: nil, legKind: &kind}
			}
		}
	}
	return out
}

func unorderedTeamPairKey(a, b string) string {
	if a < b {
		return a + "|" + b
	}
	return b + "|" + a
}

func teamsAreReturnLegs(a, b existingMatch) bool {
	if a.HomeTeamID == nil || a.AwayTeamID == nil || b.HomeTeamID == nil || b.AwayTeamID == nil {
		return false
	}
	return *a.HomeTeamID == *b.AwayTeamID && *a.AwayTeamID == *b.HomeTeamID
}

func reuseOrNewTieID(a, b *string) string {
	if a != nil && b != nil && *a == *b && strings.TrimSpace(*a) != "" {
		return *a
	}
	if a != nil && strings.TrimSpace(*a) != "" {
		return *a
	}
	if b != nil && strings.TrimSpace(*b) != "" {
		return *b
	}
	return newTieUUID()
}

func newTieUUID() string {
	var buf [16]byte
	_, _ = rand.Read(buf[:])
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16],
	)
}

func isKnockoutishPhase(phase string) bool {
	p := strings.ToLower(strings.TrimSpace(phase))
	if p == "" {
		return false
	}
	if p == "regular" || strings.Contains(p, "league") || strings.Contains(p, "group") {
		return false
	}
	switch {
	case strings.Contains(p, "final"),
		strings.Contains(p, "knock"),
		strings.Contains(p, "play"),
		strings.Contains(p, "round_of"),
		strings.Contains(p, "last_16"),
		strings.Contains(p, "last16"),
		strings.Contains(p, "quarter"),
		strings.Contains(p, "semi"),
		strings.Contains(p, "third"):
		return true
	default:
		return false
	}
}

func isFinalPhase(phase string) bool {
	p := strings.ToLower(strings.TrimSpace(phase))
	return strings.Contains(p, "final") &&
		!strings.Contains(p, "semi") &&
		!strings.Contains(p, "quarter")
}

func filterFDMatchesByKickoff(matches []fdMatch, from, to time.Time) []fdMatch {
	out := make([]fdMatch, 0, len(matches))
	for _, m := range matches {
		kickoff, err := time.Parse(time.RFC3339, m.UTCDate)
		if err != nil {
			continue
		}
		if !kickoff.Before(from) && kickoff.Before(to) {
			out = append(out, m)
		}
	}
	return out
}

func teamsFromMatches(matches []fdMatch) []fdTeam {
	byID := make(map[int]fdTeam)
	for _, match := range matches {
		if match.HomeTeam.ID != 0 {
			byID[match.HomeTeam.ID] = match.HomeTeam
		}
		if match.AwayTeam.ID != 0 {
			byID[match.AwayTeam.ID] = match.AwayTeam
		}
	}
	result := make([]fdTeam, 0, len(byID))
	for _, team := range byID {
		result = append(result, team)
	}
	return result
}

func mapFDMatch(comp competition, teamIDs map[string]string, match fdMatch) (matchRow, bool, error) {
	homeExternalID := providerExternalID(comp.ExternalProvider, match.HomeTeam.ID)
	awayExternalID := providerExternalID(comp.ExternalProvider, match.AwayTeam.ID)
	homeTeamID, homeFound := teamIDs[homeExternalID]
	awayTeamID, awayFound := teamIDs[awayExternalID]
	if !homeFound || !awayFound {
		return matchRow{}, false, nil
	}

	kickoff, err := time.Parse(time.RFC3339, match.UTCDate)
	if err != nil {
		return matchRow{}, false, fmt.Errorf("match %d has invalid utcDate %q: %w", match.ID, match.UTCDate, err)
	}
	status := mapFDStatus(match.Status)
	// Prefer regularTime (90'). fullTime may include ET on some providers.
	homeScore, awayScore := match.Score.RegularTime.Home, match.Score.RegularTime.Away
	if homeScore == nil || awayScore == nil {
		homeScore, awayScore = match.Score.FullTime.Home, match.Score.FullTime.Away
	}
	if status == "scheduled" {
		homeScore, awayScore = nil, nil
	}

	var liveMinute *int
	if status == "live" {
		liveMinute = match.Minute
	}

	postponed := isProviderPostponedStatus(match.Status)
	// Stale NS with old kickoff (no PST from API) — treat as postponed until rescheduled/finished.
	if status == "scheduled" && time.Now().UTC().Sub(kickoff) > 72*time.Hour {
		postponed = true
	}

	phase := mapFDPhase(match.Stage)
	return matchRow{
		CompetitionID:   comp.ID,
		Phase:           phase,
		RoundOrMatchday: match.Matchday,
		GroupLetter:     mapFDGroup(match.Group),
		HomeTeamID:      homeTeamID,
		AwayTeamID:      awayTeamID,
		KickoffAt:       kickoff.UTC().Format(time.RFC3339),
		Status:          status,
		HomeScore:       homeScore,
		AwayScore:       awayScore,
		ETHomeScore:     match.Score.ExtraTime.Home,
		ETAwayScore:     match.Score.ExtraTime.Away,
		PenHomeScore:    match.Score.Penalties.Home,
		PenAwayScore:    match.Score.Penalties.Away,
		LiveMinute:      liveMinute,
		ExternalID:      providerExternalID(comp.ExternalProvider, match.ID),
		IsPostponed:     postponed,
		LegKind:         inferLegKind(phase),
	}, true, nil
}

func inferLegKind(phase *string) *string {
	if phase == nil {
		return nil
	}
	p := strings.ToLower(*phase)
	switch {
	case p == "regular" || strings.Contains(p, "league") || strings.Contains(p, "group"):
		return nil
	case strings.Contains(p, "final") && !strings.Contains(p, "semi") && !strings.Contains(p, "quarter"):
		v := "final_single"
		return &v
	case strings.Contains(p, "knock") ||
		strings.Contains(p, "play") ||
		strings.Contains(p, "round_of") ||
		strings.Contains(p, "last_16") ||
		strings.Contains(p, "quarter") ||
		strings.Contains(p, "semi") ||
		strings.Contains(p, "third"):
		v := "single"
		return &v
	default:
		return nil
	}
}

func teamsEqual(current, desired teamRow) bool {
	return current.Name == desired.Name &&
		equalStringPointers(current.ShortName, desired.ShortName) &&
		equalStringPointers(current.CrestURL, desired.CrestURL) &&
		equalStringPointers(current.ExternalID, desired.ExternalID)
}

func matchesEqual(current existingMatch, desired matchRow) bool {
	return current.ExternalID == desired.ExternalID &&
		equalStringPointers(current.Phase, desired.Phase) &&
		equalIntPointers(current.RoundOrMatchday, desired.RoundOrMatchday) &&
		equalStringPointers(current.GroupLetter, desired.GroupLetter) &&
		current.HomeTeamID != nil && *current.HomeTeamID == desired.HomeTeamID &&
		current.AwayTeamID != nil && *current.AwayTeamID == desired.AwayTeamID &&
		equalTimes(current.KickoffAt, desired.KickoffAt) &&
		current.Status == desired.Status &&
		equalIntPointers(current.HomeScore, desired.HomeScore) &&
		equalIntPointers(current.AwayScore, desired.AwayScore) &&
		equalIntPointers(current.ETHomeScore, desired.ETHomeScore) &&
		equalIntPointers(current.ETAwayScore, desired.ETAwayScore) &&
		equalIntPointers(current.PenHomeScore, desired.PenHomeScore) &&
		equalIntPointers(current.PenAwayScore, desired.PenAwayScore) &&
		equalIntPointers(current.LiveMinute, desired.LiveMinute) &&
		current.IsPostponed == desired.IsPostponed
	// tie_id / leg_kind are managed by assignKnockoutTies, not mapFDMatch.
}

// findMatchForRemap remaps provider rows onto existing DB matches when
// external_id changed (e.g. fd-* → af-*) but fixture identity is the same.
// Order: kickoff ±2m → same UTC day → same round_or_matchday (home/away always).
func findMatchForRemap(
	rows []existingMatch,
	desired matchRow,
	usedIDs map[string]bool,
) (existingMatch, bool) {
	wantKickoff, kickoffErr := time.Parse(time.RFC3339, desired.KickoffAt)
	const tolerance = 2 * time.Minute

	var dayFallback, roundFallback *existingMatch
	for i := range rows {
		row := &rows[i]
		if usedIDs[row.ID] {
			continue
		}
		if row.HomeTeamID == nil || row.AwayTeamID == nil {
			continue
		}
		if *row.HomeTeamID != desired.HomeTeamID || *row.AwayTeamID != desired.AwayTeamID {
			continue
		}
		gotKickoff, err := time.Parse(time.RFC3339, row.KickoffAt)
		if err != nil {
			continue
		}
		if kickoffErr == nil {
			diff := gotKickoff.Sub(wantKickoff)
			if diff < 0 {
				diff = -diff
			}
			if diff <= tolerance {
				return *row, true
			}
			if gotKickoff.UTC().Format("2006-01-02") == wantKickoff.UTC().Format("2006-01-02") {
				if dayFallback == nil {
					dayFallback = row
				}
			}
		}
		if desired.RoundOrMatchday != nil && row.RoundOrMatchday != nil &&
			*desired.RoundOrMatchday == *row.RoundOrMatchday && roundFallback == nil {
			roundFallback = row
		}
	}
	if dayFallback != nil {
		return *dayFallback, true
	}
	if roundFallback != nil {
		return *roundFallback, true
	}
	return existingMatch{}, false
}

func equalTimes(left, right string) bool {
	leftTime, leftErr := time.Parse(time.RFC3339, left)
	rightTime, rightErr := time.Parse(time.RFC3339, right)
	if leftErr != nil || rightErr != nil {
		return left == right
	}
	return leftTime.Equal(rightTime)
}

func equalStringPointers(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// isLegacyTeamExternalID is true when a DB team may still be remapped via TLA
// (no id yet, or football-data fd-* id). API-Football af-* ids must not collide on TLA.
func isLegacyTeamExternalID(externalID *string) bool {
	if externalID == nil || strings.TrimSpace(*externalID) == "" {
		return true
	}
	return strings.HasPrefix(*externalID, "fd-")
}

func equalIntPointers(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func firstValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func optionalCodeMessage(code string) string {
	if code == "" {
		return ""
	}
	return " for code " + code
}
