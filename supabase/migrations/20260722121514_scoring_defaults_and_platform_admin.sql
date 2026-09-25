-- Default scoring: outcome 2 pts, exact bonus +3
-- Platform admin read policies for /admin dashboard

ALTER TABLE public.tournament_settings
  ALTER COLUMN points_outcome SET DEFAULT 2,
  ALTER COLUMN points_exact_bonus SET DEFAULT 3;

UPDATE public.competitions
SET default_settings = jsonb_set(
  jsonb_set(
    COALESCE(default_settings, '{}'::jsonb),
    '{points_outcome}',
    '2'::jsonb,
    true
  ),
  '{points_exact_bonus}',
  '3'::jsonb,
  true
);

CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_defaults JSONB;
BEGIN
  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner') ON CONFLICT DO NOTHING;

  SELECT COALESCE(default_settings, '{}'::jsonb) INTO v_defaults
  FROM public.competitions WHERE id = NEW.competition_id;

  INSERT INTO public.tournament_settings (
    tournament_id, points_outcome, points_exact_bonus,
    wildcard_enabled, wildcard_per_round, wildcard_multiplier, wildcard_scope,
    win_streak_enabled, win_streak_threshold, win_streak_bonus, win_streak_mode,
    special_bets_enabled, special_bet_winner_enabled, special_bet_top_scorer_enabled, special_bet_best_defense_enabled,
    points_winner, points_top_scorer, points_best_defense,
    top_scorer_mode, points_top_scorer_per_goal, winner_points_mode
  ) VALUES (
    NEW.id,
    COALESCE((v_defaults->>'points_outcome')::INT, 2),
    COALESCE((v_defaults->>'points_exact_bonus')::INT, 3),
    COALESCE((v_defaults->>'wildcard_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'wildcard_per_round')::INT, 1),
    COALESCE((v_defaults->>'wildcard_multiplier')::INT, 2),
    COALESCE(v_defaults->>'wildcard_scope', 'per_matchday'),
    COALESCE((v_defaults->>'win_streak_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'win_streak_threshold')::INT, 3),
    COALESCE((v_defaults->>'win_streak_bonus')::INT, 2),
    COALESCE(v_defaults->>'win_streak_mode', 'bonus_points'),
    COALESCE((v_defaults->>'special_bets_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'special_bet_winner_enabled')::BOOLEAN, true),
    COALESCE((v_defaults->>'special_bet_top_scorer_enabled')::BOOLEAN, true),
    COALESCE((v_defaults->>'special_bet_best_defense_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'points_winner')::INT, 20),
    COALESCE((v_defaults->>'points_top_scorer')::INT, 20),
    COALESCE((v_defaults->>'points_best_defense')::INT, 15),
    COALESCE(v_defaults->>'top_scorer_mode', 'player_match'),
    COALESCE((v_defaults->>'points_top_scorer_per_goal')::INT, 1),
    COALESCE(v_defaults->>'winner_points_mode', 'final_only')
  ) ON CONFLICT (tournament_id) DO NOTHING;

  PERFORM private.attach_existing_picks(NEW.id, NEW.owner_id);
  RETURN NEW;
END;
$function$;

-- Platform admin can list all tournaments / members (for /admin)
DROP POLICY IF EXISTS "tournaments platform admin read all" ON public.tournaments;
CREATE POLICY "tournaments platform admin read all"
  ON public.tournaments FOR SELECT TO authenticated
  USING (private.is_platform_admin());

DROP POLICY IF EXISTS "tm platform admin select all" ON public.tournament_members;
CREATE POLICY "tm platform admin select all"
  ON public.tournament_members FOR SELECT TO authenticated
  USING (private.is_platform_admin());

-- Allow platform admin to read matchday orchestrator state (dashboard)
GRANT SELECT ON public.sync_matchday_state TO authenticated;
DROP POLICY IF EXISTS "sync_matchday_state platform admin read" ON public.sync_matchday_state;
CREATE POLICY "sync_matchday_state platform admin read"
  ON public.sync_matchday_state FOR SELECT TO authenticated
  USING (private.is_platform_admin());
