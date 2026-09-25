-- Soft-launch scoring defaults by competition tier.
-- Base always 2 | +3. Special-bet point values for private create prefills;
-- public create disables specials in the app (see create.tsx).

-- 18-team leagues: winner 45, top scorer 2/g + 40 flat
UPDATE public.competitions
SET default_settings = jsonb_build_object(
  'points_outcome', 2,
  'points_exact_bonus', 3,
  'wildcard_enabled', false,
  'wildcard_scope', 'per_matchday',
  'wildcard_per_round', 1,
  'wildcard_multiplier', 2,
  'win_streak_enabled', false,
  'win_streak_threshold', 3,
  'win_streak_bonus', 2,
  'special_bets_enabled', true,
  'special_bet_winner_enabled', true,
  'special_bet_support_team_enabled', false,
  'special_bet_top_scorer_enabled', true,
  'special_bet_best_defense_enabled', false,
  'points_winner', 45,
  'points_support_advance', 3,
  'support_team_mode', 'per_phase',
  'points_top_scorer', 40,
  'points_top_scorer_per_goal', 2,
  'top_scorer_mode', 'per_goal',
  'points_best_defense', 15
)
WHERE slug IN (
  'liga-portugal-26-27',
  'bundesliga-26-27',
  'eredivisie-26-27',
  'ligue-1-26-27'
);

-- 20-team (and Championship 24 → same tier): winner 50, top scorer 2/g + 45 flat
UPDATE public.competitions
SET default_settings = jsonb_build_object(
  'points_outcome', 2,
  'points_exact_bonus', 3,
  'wildcard_enabled', false,
  'wildcard_scope', 'per_matchday',
  'wildcard_per_round', 1,
  'wildcard_multiplier', 2,
  'win_streak_enabled', false,
  'win_streak_threshold', 3,
  'win_streak_bonus', 2,
  'special_bets_enabled', true,
  'special_bet_winner_enabled', true,
  'special_bet_support_team_enabled', false,
  'special_bet_top_scorer_enabled', true,
  'special_bet_best_defense_enabled', false,
  'points_winner', 50,
  'points_support_advance', 3,
  'support_team_mode', 'per_phase',
  'points_top_scorer', 45,
  'points_top_scorer_per_goal', 2,
  'top_scorer_mode', 'per_goal',
  'points_best_defense', 15
)
WHERE slug IN (
  'premier-league-26-27',
  'la-liga-26-27',
  'serie-a-26-27',
  'brasileirao-26-27',
  'championship-26-27'
);

-- UCL / EL: support team per_phase 7 pts, top scorer 3/g + 35
UPDATE public.competitions
SET default_settings = jsonb_build_object(
  'points_outcome', 2,
  'points_exact_bonus', 3,
  'wildcard_enabled', false,
  'wildcard_scope', 'per_matchday',
  'wildcard_per_round', 1,
  'wildcard_multiplier', 2,
  'win_streak_enabled', false,
  'win_streak_threshold', 3,
  'win_streak_bonus', 2,
  'special_bets_enabled', true,
  'special_bet_winner_enabled', false,
  'special_bet_support_team_enabled', true,
  'special_bet_top_scorer_enabled', true,
  'special_bet_best_defense_enabled', false,
  'points_winner', 40,
  'points_support_advance', 7,
  'support_team_mode', 'per_phase',
  'points_top_scorer', 35,
  'points_top_scorer_per_goal', 3,
  'top_scorer_mode', 'per_goal',
  'points_best_defense', 15
)
WHERE slug IN (
  'champions-league-26-27',
  'europa-league-26-27'
);

-- Official public Predz shells (only if scoring not locked by kickoff):
-- specials fully off; keep tier point values for if enabled later.
UPDATE public.tournament_settings s
SET
  points_outcome = 2,
  points_exact_bonus = 3,
  special_bets_enabled = false,
  special_bet_winner_enabled = false,
  special_bet_support_team_enabled = false,
  special_bet_top_scorer_enabled = false,
  special_bet_best_defense_enabled = false,
  points_winner = CASE c.slug
    WHEN 'liga-portugal-26-27' THEN 45
    WHEN 'bundesliga-26-27' THEN 45
    WHEN 'eredivisie-26-27' THEN 45
    WHEN 'ligue-1-26-27' THEN 45
    WHEN 'champions-league-26-27' THEN 40
    WHEN 'europa-league-26-27' THEN 40
    ELSE 50
  END,
  points_support_advance = CASE
    WHEN c.slug IN ('champions-league-26-27', 'europa-league-26-27') THEN 7
    ELSE 3
  END,
  support_team_mode = 'per_phase',
  points_top_scorer = CASE c.slug
    WHEN 'liga-portugal-26-27' THEN 40
    WHEN 'bundesliga-26-27' THEN 40
    WHEN 'eredivisie-26-27' THEN 40
    WHEN 'ligue-1-26-27' THEN 40
    WHEN 'champions-league-26-27' THEN 35
    WHEN 'europa-league-26-27' THEN 35
    ELSE 45
  END,
  points_top_scorer_per_goal = CASE
    WHEN c.slug IN ('champions-league-26-27', 'europa-league-26-27') THEN 3
    ELSE 2
  END,
  top_scorer_mode = 'per_goal'
FROM public.tournaments t
JOIN public.competitions c ON c.id = t.competition_id
WHERE s.tournament_id = t.id
  AND t.is_official = true
  AND t.is_public = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.competition_id = t.competition_id
      AND (
        m.status IN ('live', 'finished')
        OR m.kickoff_at <= now()
      )
  );
