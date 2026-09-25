
INSERT INTO public.competitions (slug, name, country, season, format, external_provider, external_id, is_active, logo_url, default_settings)
VALUES
  ('liga-portugal-26-27', 'Liga Portugal', 'Portugal', '26/27', 'league', 'football-data', 'PPL', true, 'https://crests.football-data.org/PPL.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('premier-league-26-27', 'Premier League', 'Inglaterra', '26/27', 'league', 'football-data', 'PL', true, 'https://crests.football-data.org/PL.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('bundesliga-26-27', 'Bundesliga', 'Alemanha', '26/27', 'league', 'football-data', 'BL1', true, 'https://crests.football-data.org/BL1.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('serie-a-26-27', 'Serie A', 'Itália', '26/27', 'league', 'football-data', 'SA', true, 'https://crests.football-data.org/SA.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('la-liga-26-27', 'La Liga', 'Espanha', '26/27', 'league', 'football-data', 'PD', true, 'https://crests.football-data.org/PD.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('ligue-1-26-27', 'Ligue 1', 'França', '26/27', 'league', 'football-data', 'FL1', true, 'https://crests.football-data.org/FL1.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('championship-26-27', 'Championship', 'Inglaterra', '26/27', 'league', 'football-data', 'ELC', true, 'https://crests.football-data.org/ELC.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('eredivisie-26-27', 'Eredivisie', 'Países Baixos', '26/27', 'league', 'football-data', 'DED', true, 'https://crests.football-data.org/DED.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb),
  ('brasileirao-26-27', 'Brasileirão Série A', 'Brasil', '26/27', 'league', 'football-data', 'BSA', true, 'https://crests.football-data.org/BSA.png',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":20,"points_top_scorer":20,"points_best_defense":15}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  season = EXCLUDED.season,
  format = EXCLUDED.format,
  external_provider = EXCLUDED.external_provider,
  external_id = EXCLUDED.external_id,
  is_active = EXCLUDED.is_active,
  logo_url = EXCLUDED.logo_url,
  default_settings = COALESCE(public.competitions.default_settings, EXCLUDED.default_settings);
