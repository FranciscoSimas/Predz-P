-- 1) Scoring lock: allow initial setup while only the owner is in the tournament.
--    Still forbid turning special bets ON after the competition has started.
-- 2) Preview tournament by join code (for invite modal).

CREATE OR REPLACE FUNCTION public.lock_tournament_scoring_after_kickoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_started boolean;
  v_member_count int;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.matches m ON m.competition_id = t.competition_id
    WHERE t.id = NEW.tournament_id
      AND (
        m.status IN ('live', 'finished')
        OR m.kickoff_at <= now()
      )
  ) INTO v_started;

  IF NOT v_started THEN
    RETURN NEW;
  END IF;

  -- Specials cannot be enabled once the competition has kicked off
  IF (NEW.special_bets_enabled IS TRUE AND COALESCE(OLD.special_bets_enabled, false) IS NOT TRUE)
     OR (NEW.special_bet_winner_enabled IS TRUE AND COALESCE(OLD.special_bet_winner_enabled, false) IS NOT TRUE)
     OR (NEW.special_bet_support_team_enabled IS TRUE AND COALESCE(OLD.special_bet_support_team_enabled, false) IS NOT TRUE)
     OR (NEW.special_bet_top_scorer_enabled IS TRUE AND COALESCE(OLD.special_bet_top_scorer_enabled, false) IS NOT TRUE)
     OR (NEW.special_bet_best_defense_enabled IS TRUE AND COALESCE(OLD.special_bet_best_defense_enabled, false) IS NOT TRUE)
  THEN
    RAISE EXCEPTION 'Não é possível ativar apostas especiais depois do início da competição.';
  END IF;

  -- Brand-new tournament (create flow): only the owner is a member → allow initial rules
  SELECT COUNT(*)::int INTO v_member_count
  FROM public.tournament_members tm
  WHERE tm.tournament_id = NEW.tournament_id
    AND tm.withdrawn_at IS NULL;

  IF v_member_count <= 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.points_outcome IS DISTINCT FROM OLD.points_outcome
     OR NEW.points_exact_bonus IS DISTINCT FROM OLD.points_exact_bonus
     OR NEW.wildcard_enabled IS DISTINCT FROM OLD.wildcard_enabled
     OR NEW.wildcard_per_round IS DISTINCT FROM OLD.wildcard_per_round
     OR NEW.wildcard_multiplier IS DISTINCT FROM OLD.wildcard_multiplier
     OR NEW.wildcard_scope IS DISTINCT FROM OLD.wildcard_scope
     OR NEW.win_streak_enabled IS DISTINCT FROM OLD.win_streak_enabled
     OR NEW.win_streak_threshold IS DISTINCT FROM OLD.win_streak_threshold
     OR NEW.win_streak_bonus IS DISTINCT FROM OLD.win_streak_bonus
     OR NEW.win_streak_mode IS DISTINCT FROM OLD.win_streak_mode
     OR NEW.special_bets_enabled IS DISTINCT FROM OLD.special_bets_enabled
     OR NEW.special_bet_winner_enabled IS DISTINCT FROM OLD.special_bet_winner_enabled
     OR NEW.special_bet_support_team_enabled IS DISTINCT FROM OLD.special_bet_support_team_enabled
     OR NEW.special_bet_top_scorer_enabled IS DISTINCT FROM OLD.special_bet_top_scorer_enabled
     OR NEW.special_bet_best_defense_enabled IS DISTINCT FROM OLD.special_bet_best_defense_enabled
     OR NEW.points_winner IS DISTINCT FROM OLD.points_winner
     OR NEW.points_support_advance IS DISTINCT FROM OLD.points_support_advance
     OR NEW.support_team_mode IS DISTINCT FROM OLD.support_team_mode
     OR NEW.points_top_scorer IS DISTINCT FROM OLD.points_top_scorer
     OR NEW.points_best_defense IS DISTINCT FROM OLD.points_best_defense
     OR NEW.points_top_scorer_per_goal IS DISTINCT FROM OLD.points_top_scorer_per_goal
     OR NEW.top_scorer_mode IS DISTINCT FROM OLD.top_scorer_mode
     OR NEW.special_bets_cutoff_at IS DISTINCT FROM OLD.special_bets_cutoff_at
     OR NEW.winner_points_mode IS DISTINCT FROM OLD.winner_points_mode
  THEN
    RAISE EXCEPTION 'As regras de pontuação não podem ser alteradas depois do primeiro apito da competição.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_tournament_by_code(_code text)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  is_public boolean,
  is_official boolean,
  join_code text,
  competition_name text,
  competition_logo_url text,
  member_count integer,
  already_member boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(trim(_code));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  IF v_code IS NULL OR length(v_code) < 4 THEN
    RAISE EXCEPTION 'Código inválido.';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.description,
    t.is_public,
    t.is_official,
    t.join_code,
    c.name AS competition_name,
    c.logo_url AS competition_logo_url,
    (
      SELECT COUNT(*)::int
      FROM public.tournament_members tm
      WHERE tm.tournament_id = t.id
        AND tm.withdrawn_at IS NULL
    ) AS member_count,
    EXISTS (
      SELECT 1
      FROM public.tournament_members tm
      WHERE tm.tournament_id = t.id
        AND tm.user_id = v_uid
        AND tm.withdrawn_at IS NULL
    ) AS already_member
  FROM public.tournaments t
  JOIN public.competitions c ON c.id = t.competition_id
  WHERE t.join_code = v_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_tournament_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tournament_by_code(text) TO authenticated, service_role;
