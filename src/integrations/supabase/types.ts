export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      competition_standing_zones: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          label_en: string
          label_pt: string
          position_from: number
          position_to: number
          sort_order: number
          zone_key: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          label_en: string
          label_pt: string
          position_from: number
          position_to: number
          sort_order?: number
          zone_key: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          label_en?: string
          label_pt?: string
          position_from?: number
          position_to?: number
          sort_order?: number
          zone_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_standing_zones_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_players: {
        Row: {
          competition_id: string
          external_id: string
          id: string
          name: string
          photo_url: string | null
          position: string | null
          shirt_number: number | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          external_id: string
          id?: string
          name: string
          photo_url?: string | null
          position?: string | null
          shirt_number?: number | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          external_id?: string
          id?: string
          name?: string
          photo_url?: string | null
          position?: string | null
          shirt_number?: number | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_players_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_teams: {
        Row: {
          competition_id: string
          created_at: string
          crest_override_url: string | null
          crest_url: string | null
          external_id: string | null
          group_letter: string | null
          id: string
          name: string
          short_name: string | null
        }
        Insert: {
          competition_id: string
          created_at?: string
          crest_override_url?: string | null
          crest_url?: string | null
          external_id?: string | null
          group_letter?: string | null
          id?: string
          name: string
          short_name?: string | null
        }
        Update: {
          competition_id?: string
          created_at?: string
          crest_override_url?: string | null
          crest_url?: string | null
          external_id?: string | null
          group_letter?: string | null
          id?: string
          name?: string
          short_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_teams_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          country: string | null
          created_at: string
          default_settings: Json
          external_id: string | null
          external_provider: string | null
          format: Database["public"]["Enums"]["competition_format"]
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          season: string
          slug: string
          sofascore_widget_url: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          default_settings?: Json
          external_id?: string | null
          external_provider?: string | null
          format: Database["public"]["Enums"]["competition_format"]
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          season: string
          slug: string
          sofascore_widget_url?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          default_settings?: Json
          external_id?: string | null
          external_provider?: string | null
          format?: Database["public"]["Enums"]["competition_format"]
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          season?: string
          slug?: string
          sofascore_widget_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          away_label: string | null
          away_score: number | null
          away_team_id: string | null
          competition_id: string
          created_at: string
          et_away_score: number | null
          et_home_score: number | null
          external_id: string | null
          finished_at: string | null
          group_letter: string | null
          home_label: string | null
          home_score: number | null
          home_team_id: string | null
          id: string
          is_postponed: boolean
          kickoff_at: string
          leg_kind: string | null
          live_minute: number | null
          manual_override: boolean
          pen_away_score: number | null
          pen_home_score: number | null
          phase: string | null
          round_or_matchday: number | null
          status: Database["public"]["Enums"]["match_status"]
          tie_id: string | null
          updated_at: string
        }
        Insert: {
          away_label?: string | null
          away_score?: number | null
          away_team_id?: string | null
          competition_id: string
          created_at?: string
          et_away_score?: number | null
          et_home_score?: number | null
          external_id?: string | null
          finished_at?: string | null
          group_letter?: string | null
          home_label?: string | null
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          is_postponed?: boolean
          kickoff_at: string
          leg_kind?: string | null
          live_minute?: number | null
          manual_override?: boolean
          pen_away_score?: number | null
          pen_home_score?: number | null
          phase?: string | null
          round_or_matchday?: number | null
          status?: Database["public"]["Enums"]["match_status"]
          tie_id?: string | null
          updated_at?: string
        }
        Update: {
          away_label?: string | null
          away_score?: number | null
          away_team_id?: string | null
          competition_id?: string
          created_at?: string
          et_away_score?: number | null
          et_home_score?: number | null
          external_id?: string | null
          finished_at?: string | null
          group_letter?: string | null
          home_label?: string | null
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          is_postponed?: boolean
          kickoff_at?: string
          leg_kind?: string | null
          live_minute?: number | null
          manual_override?: boolean
          pen_away_score?: number | null
          pen_home_score?: number | null
          phase?: string | null
          round_or_matchday?: number | null
          status?: Database["public"]["Enums"]["match_status"]
          tie_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_season_stats: {
        Row: {
          competition_id: string
          goals: number
          player_external_id: string
          season: string
          updated_at: string
        }
        Insert: {
          competition_id: string
          goals?: number
          player_external_id: string
          season: string
          updated_at?: string
        }
        Update: {
          competition_id?: string
          goals?: number
          player_external_id?: string
          season?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_season_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      predictions: {
        Row: {
          created_at: string
          exact: boolean
          id: string
          is_wildcard: boolean
          match_id: string
          pick_id: string
          points: number
          points_90: number
          points_advancement: number
          points_before_multiplier: number
          points_et: number
          points_pen: number
          tournament_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exact?: boolean
          id?: string
          is_wildcard?: boolean
          match_id: string
          pick_id: string
          points?: number
          points_90?: number
          points_advancement?: number
          points_before_multiplier?: number
          points_et?: number
          points_pen?: number
          tournament_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exact?: boolean
          id?: string
          is_wildcard?: boolean
          match_id?: string
          pick_id?: string
          points?: number
          points_90?: number
          points_advancement?: number
          points_before_multiplier?: number
          points_et?: number
          points_pen?: number
          tournament_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "user_match_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      special_bets: {
        Row: {
          bet_type: Database["public"]["Enums"]["special_bet_type"]
          created_at: string
          id: string
          points: number
          team_id: string | null
          tournament_id: string
          updated_at: string
          user_id: string
          value: string
          player_external_id: string | null
        }
        Insert: {
          bet_type: Database["public"]["Enums"]["special_bet_type"]
          created_at?: string
          id?: string
          points?: number
          team_id?: string | null
          tournament_id: string
          updated_at?: string
          user_id: string
          value: string
          player_external_id?: string | null
        }
        Update: {
          bet_type?: Database["public"]["Enums"]["special_bet_type"]
          created_at?: string
          id?: string
          points?: number
          team_id?: string | null
          tournament_id?: string
          updated_at?: string
          user_id?: string
          value?: string
          player_external_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "special_bets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_bets_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_member_streaks: {
        Row: {
          best_streak: number
          bonus_points: number
          current_streak: number
          tournament_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          best_streak?: number
          bonus_points?: number
          current_streak?: number
          tournament_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          best_streak?: number
          bonus_points?: number
          current_streak?: number
          tournament_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_member_streaks_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["tournament_role"]
          tournament_id: string
          user_id: string
          withdrawn_at: string | null
          pred_points: number
          correct_count: number
          exact_count: number
          predictions_made: number
          wildcards_used: number
          special_bets_points: number
          stats_updated_at: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["tournament_role"]
          tournament_id: string
          user_id: string
          withdrawn_at?: string | null
          pred_points?: number
          correct_count?: number
          exact_count?: number
          predictions_made?: number
          wildcards_used?: number
          special_bets_points?: number
          stats_updated_at?: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["tournament_role"]
          tournament_id?: string
          user_id?: string
          withdrawn_at?: string | null
          pred_points?: number
          correct_count?: number
          exact_count?: number
          predictions_made?: number
          wildcards_used?: number
          special_bets_points?: number
          stats_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_members_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_settings: {
        Row: {
          official_best_defense_team_id: string | null
          official_top_scorer: string | null
          official_top_scorer_external_id: string | null
          official_top_scorer_goals: number | null
          official_winner_team_id: string | null
          points_90_outcome: number
          points_advance: number
          points_best_defense: number
          points_et_outcome: number
          points_exact_90: number
          points_exact_bonus: number
          points_exact_et: number
          points_outcome: number
          points_pen_exact: number
          points_support_advance: number
          support_team_mode: string
          points_top_scorer: number
          points_top_scorer_per_goal: number
          points_winner: number
          points_winner_final: number
          points_winner_group: number
          points_winner_quarter: number
          points_winner_r16: number
          points_winner_semi: number
          predictions_cutoff: string
          prize_custom: Json
          prize_entry_amount: number
          prize_entry_currency: string
          prize_pct_first: number
          prize_pct_second: number
          prize_pct_third: number
          prizes_enabled: boolean
          special_bet_best_defense_enabled: boolean
          special_bet_support_team_enabled: boolean
          special_bet_top_scorer_enabled: boolean
          special_bet_winner_enabled: boolean
          special_bets_cutoff_at: string | null
          special_bets_enabled: boolean
          support_team_mode: string
          top_scorer_mode: string
          tournament_id: string
          updated_at: string
          wildcard_enabled: boolean
          wildcard_multiplier: number
          wildcard_per_round: number
          wildcard_scope: string
          win_streak_bonus: number
          win_streak_enabled: boolean
          win_streak_mode: string
          win_streak_threshold: number
          winner_points_mode: string
        }
        Insert: {
          official_best_defense_team_id?: string | null
          official_top_scorer?: string | null
          official_top_scorer_external_id?: string | null
          official_top_scorer_goals?: number | null
          official_winner_team_id?: string | null
          points_90_outcome?: number
          points_advance?: number
          points_best_defense?: number
          points_et_outcome?: number
          points_exact_90?: number
          points_exact_bonus?: number
          points_exact_et?: number
          points_outcome?: number
          points_pen_exact?: number
          points_support_advance?: number
          support_team_mode?: string
          points_top_scorer?: number
          points_top_scorer_per_goal?: number
          points_winner?: number
          points_winner_final?: number
          points_winner_group?: number
          points_winner_quarter?: number
          points_winner_r16?: number
          points_winner_semi?: number
          predictions_cutoff?: string
          prize_custom?: Json
          prize_entry_amount?: number
          prize_entry_currency?: string
          prize_pct_first?: number
          prize_pct_second?: number
          prize_pct_third?: number
          prizes_enabled?: boolean
          special_bet_best_defense_enabled?: boolean
          special_bet_support_team_enabled?: boolean
          special_bet_top_scorer_enabled?: boolean
          special_bet_winner_enabled?: boolean
          special_bets_cutoff_at?: string | null
          special_bets_enabled?: boolean
          top_scorer_mode?: string
          tournament_id: string
          updated_at?: string
          wildcard_enabled?: boolean
          wildcard_multiplier?: number
          wildcard_per_round?: number
          wildcard_scope?: string
          win_streak_bonus?: number
          win_streak_enabled?: boolean
          win_streak_mode?: string
          win_streak_threshold?: number
          winner_points_mode?: string
        }
        Update: {
          official_best_defense_team_id?: string | null
          official_top_scorer?: string | null
          official_top_scorer_external_id?: string | null
          official_top_scorer_goals?: number | null
          official_winner_team_id?: string | null
          points_90_outcome?: number
          points_advance?: number
          points_best_defense?: number
          points_et_outcome?: number
          points_exact_90?: number
          points_exact_bonus?: number
          points_exact_et?: number
          points_outcome?: number
          points_pen_exact?: number
          points_support_advance?: number
          support_team_mode?: string
          points_top_scorer?: number
          points_top_scorer_per_goal?: number
          points_winner?: number
          points_winner_final?: number
          points_winner_group?: number
          points_winner_quarter?: number
          points_winner_r16?: number
          points_winner_semi?: number
          predictions_cutoff?: string
          prize_custom?: Json
          prize_entry_amount?: number
          prize_entry_currency?: string
          prize_pct_first?: number
          prize_pct_second?: number
          prize_pct_third?: number
          prizes_enabled?: boolean
          special_bet_best_defense_enabled?: boolean
          special_bet_support_team_enabled?: boolean
          special_bet_top_scorer_enabled?: boolean
          special_bet_winner_enabled?: boolean
          special_bets_cutoff_at?: string | null
          special_bets_enabled?: boolean
          top_scorer_mode?: string
          tournament_id?: string
          updated_at?: string
          wildcard_enabled?: boolean
          wildcard_multiplier?: number
          wildcard_per_round?: number
          wildcard_scope?: string
          win_streak_bonus?: number
          win_streak_enabled?: boolean
          win_streak_mode?: string
          win_streak_threshold?: number
          winner_points_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_settings_official_best_defense_team_id_fkey"
            columns: ["official_best_defense_team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_settings_official_winner_team_id_fkey"
            columns: ["official_winner_team_id"]
            isOneToOne: false
            referencedRelation: "competition_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_settings_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: true
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          competition_id: string
          cover_color: string | null
          created_at: string
          description: string | null
          id: string
          is_official: boolean
          is_public: boolean
          join_code: string
          name: string
          owner_id: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          cover_color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_official?: boolean
          is_public?: boolean
          join_code: string
          name: string
          owner_id: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          cover_color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_official?: boolean
          is_public?: boolean
          join_code?: string
          name?: string
          owner_id?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_match_picks: {
        Row: {
          away_pred: number
          created_at: string
          et_away_pred: number | null
          et_home_pred: number | null
          home_pred: number
          id: string
          match_id: string
          pen_away_pred: number | null
          pen_home_pred: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          away_pred: number
          created_at?: string
          et_away_pred?: number | null
          et_home_pred?: number | null
          home_pred: number
          id?: string
          match_id: string
          pen_away_pred?: number | null
          pen_home_pred?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          away_pred?: number
          created_at?: string
          et_away_pred?: number | null
          et_home_pred?: number | null
          home_pred?: number
          id?: string
          match_id?: string
          pen_away_pred?: number | null
          pen_home_pred?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_match_picks_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      prediction_entries: {
        Row: {
          away_pred: number | null
          created_at: string | null
          et_away_pred: number | null
          et_home_pred: number | null
          exact: boolean | null
          home_pred: number | null
          id: string | null
          is_wildcard: boolean | null
          match_id: string | null
          pen_away_pred: number | null
          pen_home_pred: number | null
          pick_id: string | null
          points: number | null
          points_90: number | null
          points_advancement: number | null
          points_before_multiplier: number | null
          points_et: number | null
          points_pen: number | null
          tournament_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "user_match_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_leaderboard: {
        Row: {
          avatar_url: string | null
          best_defense_team_id: string | null
          best_defense_team_name: string | null
          best_streak: number | null
          correct_count: number | null
          current_streak: number | null
          display_name: string | null
          exact_count: number | null
          predictions_made: number | null
          special_bets_points: number | null
          streak_bonus_points: number | null
          support_advances: number | null
          support_team_id: string | null
          support_team_name: string | null
          top_scorer_goals: number | null
          top_scorer_name: string | null
          top_scorer_photo_url: string | null
          total_points: number | null
          tournament_id: string | null
          user_id: string | null
          wildcards_used: number | null
          winner_team_id: string | null
          winner_team_name: string | null
          withdrawn_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calc_prediction_points: {
        Args: {
          _away_pred: number
          _away_score: number
          _et_away_pred?: number
          _et_away_score?: number
          _et_home_pred?: number
          _et_home_score?: number
          _home_pred: number
          _home_score: number
          _is_knockout?: boolean
          _p_exact_bonus: number
          _p_outcome: number
          _pen_away_pred?: number
          _pen_away_score?: number
          _pen_home_pred?: number
          _pen_home_score?: number
        }
        Returns: {
          exact: boolean
          points: number
        }[]
      }
      join_tournament_by_code: { Args: { _code: string }; Returns: string }
      join_tournament_by_code_as: {
        Args: { _as_spectator: boolean; _code: string }
        Returns: string
      }
      preview_tournament_by_code: {
        Args: { _code: string }
        Returns: {
          already_member: boolean
          competition_logo_url: string | null
          competition_name: string
          description: string | null
          id: string
          is_official: boolean
          is_public: boolean
          join_code: string
          member_count: number
          name: string
        }[]
      }
      get_tournament_leaderboard: {
        Args: { _tournament_id: string }
        Returns: {
          avatar_url: string | null
          best_defense_team_id: string | null
          best_defense_team_name: string | null
          best_streak: number | null
          correct_count: number | null
          current_streak: number | null
          display_name: string | null
          exact_count: number | null
          predictions_made: number | null
          special_bets_points: number | null
          streak_bonus_points: number | null
          support_advances: number | null
          support_team_id: string | null
          support_team_name: string | null
          top_scorer_goals: number | null
          top_scorer_name: string | null
          top_scorer_photo_url: string | null
          total_points: number | null
          tournament_id: string | null
          user_id: string | null
          wildcards_used: number | null
          winner_team_id: string | null
          winner_team_name: string | null
          withdrawn_at: string | null
        }[]
      }
      is_display_name_available: {
        Args: { _name: string; _user_id?: string }
        Returns: boolean
      }
      list_match_tournament_predictions: {
        Args: { _match_id: string; _tournament_id: string }
        Returns: {
          away_pred: number | null
          display_name: string | null
          exact: boolean | null
          home_pred: number | null
          is_wildcard: boolean | null
          points: number | null
          user_id: string
          withdrawn_at: string | null
        }[]
      }
      list_tournament_members: {
        Args: { _tournament_id: string }
        Returns: {
          avatar_url: string | null
          display_name: string | null
          joined_at: string
          role: Database["public"]["Enums"]["tournament_role"]
          user_id: string
          withdrawn_at: string | null
        }[]
      }
      platform_admin_list_users: {
        Args: Record<string, never>
        Returns: {
          avatar_url: string | null
          display_name: string | null
          tournament_count: number
          user_id: string
        }[]
      }
      list_user_tournament_predictions: {
        Args: { _tournament_id: string; _user_id: string }
        Returns: {
          away_pred: number | null
          away_score: number | null
          away_team_name: string | null
          exact: boolean | null
          home_pred: number | null
          home_score: number | null
          home_team_name: string | null
          is_wildcard: boolean | null
          kickoff_at: string
          match_id: string
          points: number | null
          status: Database["public"]["Enums"]["match_status"]
        }[]
      }
      withdraw_from_tournament: {
        Args: { _tournament_id: string }
        Returns: undefined
      }
      join_public_tournament: {
        Args: { _tournament_id: string }
        Returns: string
      }
      join_public_tournament_as: {
        Args: { _as_spectator: boolean; _tournament_id: string }
        Returns: string
      }
      upsert_shared_match_prediction: {
        Args: {
          _away_pred: number
          _et_away_pred?: number
          _et_home_pred?: number
          _home_pred: number
          _is_wildcard?: boolean
          _match_id: string
          _pen_away_pred?: number
          _pen_home_pred?: number
          _tournament_id?: string
        }
        Returns: Json
      }
      upsert_shared_match_predictions_batch: {
        Args: {
          _items: Json
          _tournament_id: string
        }
        Returns: Json
      }
      recalc_special_bets: {
        Args: { _tournament_id: string }
        Returns: undefined
      }
      recalc_tournament_streaks: {
        Args: { _tournament_id: string }
        Returns: undefined
      }
    }
    Enums: {
      competition_format:
        | "league"
        | "groups_then_knockout"
        | "league_phase_then_knockout"
        | "groups_then_finals"
        | "knockout_only"
      match_status: "scheduled" | "live" | "finished"
      special_bet_type: "winner" | "top_scorer" | "best_defense" | "support_team"
      tournament_role: "owner" | "admin" | "member" | "spectator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      competition_format: [
        "league",
        "groups_then_knockout",
        "league_phase_then_knockout",
        "groups_then_finals",
        "knockout_only",
      ],
      match_status: ["scheduled", "live", "finished"],
      special_bet_type: ["winner", "top_scorer", "best_defense", "support_team"],
      tournament_role: ["owner", "admin", "member", "spectator"],
    },
  },
} as const
