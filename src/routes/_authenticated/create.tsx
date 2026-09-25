import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Globe2, Lock, Info, Star, Flame, Sparkles } from "lucide-react";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { NumberInput } from "@/components/NumberInput";
import { PrizesForm, defaultPrizes, type PrizesValue } from "@/components/PrizesForm";
import { useT } from "@/lib/i18n";
import { isKnockoutishFormat, isLeagueFormat, isCalendarPendingCompetition } from "@/lib/competition-format";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/create")({
  component: CreatePage,
});

function genCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

type CompetitionRow = {
  id: string;
  name: string;
  season: string;
  format: string;
  country: string | null;
  logo_url: string | null;
  slug: string;
  default_settings: Record<string, unknown> | null;
};

type StepId = "info" | "privacy" | "competition" | "points" | "modules" | "prizes";

const SEASON_WILDCARD_FALLBACK = 22;

function seasonWildcardQty(matchdayCount: number) {
  return matchdayCount > 0 ? matchdayCount : SEASON_WILDCARD_FALLBACK;
}

function CreatePage() {
  const navigate = useNavigate();
  const { t, formatLabel } = useT();
  const isMobile = useIsMobile();
  const [step, setStep] = useState(0);
  const [navLocked, setNavLocked] = useState(false);
  const submitGuard = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [competitionId, setCompetitionId] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [pointsOutcome, setPointsOutcome] = useState(2);
  const [pointsExact, setPointsExact] = useState(3);
  const [wildcardEnabled, setWildcardEnabled] = useState(false);
  const [wildcardPerRound, setWildcardPerRound] = useState(1);
  const [wildcardMultiplier, setWildcardMultiplier] = useState(2);
  const [wildcardScope, setWildcardScope] = useState<"per_matchday" | "per_season">("per_matchday");
  const [streakEnabled, setStreakEnabled] = useState(false);
  const [streakThreshold, setStreakThreshold] = useState(3);
  const [streakBonus, setStreakBonus] = useState(2);
  const [specialEnabled, setSpecialEnabled] = useState(true);
  const [specialWinner, setSpecialWinner] = useState(true);
  const [specialSupportTeam, setSpecialSupportTeam] = useState(false);
  const [specialTopScorer, setSpecialTopScorer] = useState(true);
  const [specialBestDefense, setSpecialBestDefense] = useState(false);
  const [pointsWinner, setPointsWinner] = useState(20);
  const [pointsSupportAdvance, setPointsSupportAdvance] = useState(3);
  const [supportTeamMode, setSupportTeamMode] = useState<"per_phase" | "champion">("per_phase");
  const [pointsTopScorer, setPointsTopScorer] = useState(20);
  const [pointsTopScorerPerGoal, setPointsTopScorerPerGoal] = useState(1);
  const [topScorerMode, setTopScorerMode] = useState<"player_match" | "per_goal">("per_goal");
  const [pointsBestDefense, setPointsBestDefense] = useState(15);
  const [specialCutoffAt, setSpecialCutoffAt] = useState<string | null>(null);
  const [prizes, setPrizes] = useState<PrizesValue>(defaultPrizes);
  const [saving, setSaving] = useState(false);

  const { data: competitions } = useQuery({
    queryKey: ["competitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, season, format, country, logo_url, slug, default_settings")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as CompetitionRow[];
    },
  });

  const { data: matchdayCount = 0 } = useQuery({
    queryKey: ["competition-matchday-count", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("round_or_matchday")
        .eq("competition_id", competitionId)
        .not("round_or_matchday", "is", null);
      if (error) throw error;
      const rounds = new Set<number>();
      for (const row of data ?? []) {
        if (row.round_or_matchday != null) rounds.add(row.round_or_matchday);
      }
      return rounds.size;
    },
  });

  const { data: competitionStarted = false, isFetching: checkingCompetitionStarted } = useQuery({
    queryKey: ["competition-started", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data: byStatus, error: statusErr } = await supabase
        .from("matches")
        .select("id")
        .eq("competition_id", competitionId)
        .in("status", ["live", "finished"])
        .limit(1);
      if (statusErr) throw statusErr;
      if ((byStatus?.length ?? 0) > 0) return true;

      const { data: byKickoff, error: kickErr } = await supabase
        .from("matches")
        .select("id")
        .eq("competition_id", competitionId)
        .lte("kickoff_at", new Date().toISOString())
        .limit(1);
      if (kickErr) throw kickErr;
      return (byKickoff?.length ?? 0) > 0;
    },
  });

  const specialsLocked = competitionStarted;
  const specialsToggleDisabled =
    !!competitionId && (checkingCompetitionStarted || competitionStarted);

  const selectedComp = useMemo(
    () => competitions?.find((c) => c.id === competitionId) ?? null,
    [competitions, competitionId],
  );

  const isLeague = isLeagueFormat(selectedComp?.format);
  const isKnockoutish = isKnockoutishFormat(selectedComp?.format);

  const stepIds = useMemo<StepId[]>(() => {
    const ids: StepId[] = ["info", "privacy", "competition", "points", "modules"];
    if (!isPublic) ids.push("prizes");
    return ids;
  }, [isPublic]);

  useEffect(() => {
    if (step >= stepIds.length) setStep(Math.max(0, stepIds.length - 1));
  }, [step, stepIds.length]);

  useEffect(() => {
    if (!isMobile) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    setNavLocked(true);
    const timer = window.setTimeout(() => setNavLocked(false), 500);
    return () => window.clearTimeout(timer);
  }, [step, isMobile]);

  // Prefill from competition defaults + privacy (public = specials off)
  useEffect(() => {
    if (!selectedComp) return;
    const d = (selectedComp.default_settings ?? {}) as Record<string, unknown>;
    const num = (k: string, def: number) => {
      const v = d[k];
      return typeof v === "number" ? v : def;
    };
    const bool = (k: string, def: boolean) => {
      const v = d[k];
      return typeof v === "boolean" ? v : def;
    };
    const str = (k: string, def: string) => {
      const v = d[k];
      return typeof v === "string" ? v : def;
    };
    setPointsOutcome(num("points_outcome", 2));
    setPointsExact(num("points_exact_bonus", 3));
    setWildcardEnabled(bool("wildcard_enabled", false));
    const scope =
      str("wildcard_scope", "per_matchday") === "per_season" ? "per_season" : "per_matchday";
    setWildcardScope(scope);
    setWildcardMultiplier(num("wildcard_multiplier", 2));
    setWildcardPerRound(scope === "per_matchday" ? 1 : num("wildcard_per_round", 1));
    setStreakEnabled(bool("win_streak_enabled", false));
    setStreakThreshold(num("win_streak_threshold", 3));
    setStreakBonus(num("win_streak_bonus", 2));
    const league = isLeagueFormat(selectedComp.format);
    const knockoutish = isKnockoutishFormat(selectedComp.format);
    // Public tournaments: specials off. Private: winner (league) / support champion (UCL-EL) + top scorer per goal.
    if (isPublic) {
      setSpecialEnabled(false);
      setSpecialWinner(false);
      setSpecialSupportTeam(false);
      setSpecialTopScorer(false);
      setSpecialBestDefense(false);
    } else {
      setSpecialEnabled(true);
      setSpecialWinner(league && bool("special_bet_winner_enabled", league));
      setSpecialSupportTeam(knockoutish && bool("special_bet_support_team_enabled", knockoutish));
      setSpecialTopScorer(bool("special_bet_top_scorer_enabled", true));
      setSpecialBestDefense(false);
    }
    setPointsWinner(num("points_winner", league ? 45 : 40));
    setPointsSupportAdvance(num("points_support_advance", knockoutish ? 7 : 3));
    setSupportTeamMode(
      str("support_team_mode", "per_phase") === "champion" ? "champion" : "per_phase",
    );
    setPointsTopScorer(num("points_top_scorer", 40));
    setPointsTopScorerPerGoal(num("points_top_scorer_per_goal", 2));
    setTopScorerMode(str("top_scorer_mode", "per_goal") === "player_match" ? "player_match" : "per_goal");
    setPointsBestDefense(num("points_best_defense", 15));
  }, [selectedComp, isPublic]);

  // Competition already underway: special bets cannot be enabled
  useEffect(() => {
    if (!competitionStarted) return;
    setSpecialEnabled(false);
    setSpecialWinner(false);
    setSpecialSupportTeam(false);
    setSpecialTopScorer(false);
    setSpecialBestDefense(false);
  }, [competitionStarted]);

  // When matchday count loads and scope is per season, default quantity
  useEffect(() => {
    if (!competitionId || wildcardScope !== "per_season") return;
    setWildcardPerRound(seasonWildcardQty(matchdayCount));
  }, [competitionId, matchdayCount, wildcardScope]);

  // Default special-bet cutoff to first kickoff when competition changes
  useEffect(() => {
    if (!competitionId) {
      setSpecialCutoffAt(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("kickoff_at")
        .eq("competition_id", competitionId)
        .order("kickoff_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setSpecialCutoffAt(data?.kickoff_at ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  function applyWildcardScope(scope: "per_matchday" | "per_season") {
    setWildcardScope(scope);
    setWildcardMultiplier(2);
    if (scope === "per_matchday") {
      setWildcardPerRound(1);
    } else {
      setWildcardPerRound(seasonWildcardQty(matchdayCount));
    }
  }

  function validateStep(id: StepId): boolean {
    if (id === "info" && !name.trim()) {
      toast.error(t.create.needNameCompetition);
      return false;
    }
    if (id === "competition" && !competitionId) {
      toast.error(t.create.needNameCompetition);
      return false;
    }
    if (id === "prizes" && !isPublic && prizes.prizes_enabled && prizes.prize_entry_amount > 0) {
      const pctSum = prizes.prize_pct_first + prizes.prize_pct_second + prizes.prize_pct_third;
      if (pctSum !== 100) {
        toast.error(t.prizes.sumMust100);
        return false;
      }
    }
    return true;
  }

  function goNext() {
    const id = stepIds[step];
    if (!validateStep(id)) return;
    setStep((s) => Math.min(s + 1, stepIds.length - 1));
  }

  async function doSubmit() {
    if (submitGuard.current || saving) return;
    if (!name || !competitionId) return toast.error(t.create.needNameCompetition);
    const pctSum = prizes.prize_pct_first + prizes.prize_pct_second + prizes.prize_pct_third;
    if (!isPublic && prizes.prizes_enabled && prizes.prize_entry_amount > 0 && pctSum !== 100) {
      return toast.error(t.prizes.sumMust100);
    }
    submitGuard.current = true;
    setSaving(true);
    const { data: uRes } = await supabase.auth.getUser();
    const uid = uRes.user?.id;
    if (!uid) {
      setSaving(false);
      submitGuard.current = false;
      return toast.error(t.common.sessionExpired);
    }

    const { data, error } = await supabase
      .from("tournaments")
      .insert({
        name: name.trim(),
        description: description.trim(),
        owner_id: uid,
        competition_id: competitionId,
        is_public: isPublic,
        join_code: genCode(),
      })
      .select("id")
      .single();

    if (error) {
      setSaving(false);
      submitGuard.current = false;
      return toast.error(error.message);
    }

    const settingsPayload: Record<string, unknown> = {
      points_outcome: pointsOutcome,
      points_exact_bonus: pointsExact,
      wildcard_enabled: wildcardEnabled,
      wildcard_per_round: wildcardPerRound,
      wildcard_multiplier: wildcardMultiplier,
      wildcard_scope: wildcardScope,
      win_streak_enabled: streakEnabled,
      win_streak_threshold: streakThreshold,
      win_streak_bonus: streakBonus,
      special_bets_enabled: specialEnabled && !specialsLocked,
      special_bet_winner_enabled:
        specialEnabled && !specialsLocked && isLeague && specialWinner,
      special_bet_support_team_enabled:
        specialEnabled && !specialsLocked && isKnockoutish && specialSupportTeam,
      special_bet_top_scorer_enabled:
        specialEnabled && !specialsLocked && specialTopScorer,
      special_bet_best_defense_enabled:
        specialEnabled && !specialsLocked && specialBestDefense,
      points_winner: pointsWinner,
      points_support_advance: pointsSupportAdvance,
      support_team_mode: supportTeamMode,
      points_top_scorer: pointsTopScorer,
      points_top_scorer_per_goal: pointsTopScorerPerGoal,
      top_scorer_mode: topScorerMode,
      points_best_defense: pointsBestDefense,
      special_bets_cutoff_at: specialCutoffAt,
    };
    if (!isPublic && prizes.prizes_enabled) {
      settingsPayload.prizes_enabled = true;
      settingsPayload.prize_entry_amount = prizes.prize_entry_amount;
      settingsPayload.prize_entry_currency = prizes.prize_entry_currency;
      settingsPayload.prize_pct_first = prizes.prize_pct_first;
      settingsPayload.prize_pct_second = prizes.prize_pct_second;
      settingsPayload.prize_pct_third = prizes.prize_pct_third;
      settingsPayload.prize_custom = prizes.prize_custom;
    }

    let { error: sErr } = await supabase
      .from("tournament_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(settingsPayload as any)
      .eq("tournament_id", data.id);

    // Column may be missing until migration 20260724110000 is applied remotely.
    if (sErr?.message?.includes("support_team_mode")) {
      const { support_team_mode: _omit, ...withoutMode } = settingsPayload;
      const retry = await supabase
        .from("tournament_settings")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(withoutMode as any)
        .eq("tournament_id", data.id);
      sErr = retry.error;
      if (!retry.error) {
        toast.warning(
          "Torneio criado. Aplica a migration support_team_mode no Supabase para gravar o modo Campeão.",
        );
      }
    }

    setSaving(false);
    if (sErr) {
      toast.warning(`${t.create.warnSaveRules} ${sErr.message}`);
    } else {
      toast.success(t.create.createdOk);
    }
    navigate({ to: "/t/$id", params: { id: data.id } });
  }

  const supportHint =
    supportTeamMode === "champion"
      ? t.create.supportTeamHintChampion.replaceAll("{x}", String(pointsSupportAdvance))
      : t.create.supportTeamHint.replaceAll("{x}", String(pointsSupportAdvance));

  const pointsHint = t.create.pointsHint
    .replace("{outcome}", String(pointsOutcome))
    .replace("{exact}", String(pointsExact));

  const sectionInfo = (
    <Section title={t.create.section1}>
      <div>
        <Label htmlFor="name">{t.create.name}</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required={!isMobile}
          className="mt-1.5 h-11"
          placeholder={t.create.namePlaceholder}
        />
      </div>
      <div>
        <Label htmlFor="desc">{t.create.description}</Label>
        <Textarea
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1.5"
          rows={2}
          placeholder={t.create.descriptionPlaceholder}
        />
      </div>
    </Section>
  );

  const sectionPrivacy = (
    <Section title={t.create.section2}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PrivacyCard
          selected={!isPublic}
          onClick={() => setIsPublic(false)}
          icon={<Lock className="w-4 h-4" />}
          title={t.create.private}
          description={t.create.privateDesc}
        />
        <PrivacyCard
          selected={isPublic}
          onClick={() => setIsPublic(true)}
          icon={<Globe2 className="w-4 h-4" />}
          title={t.create.public}
          description={t.create.publicDesc}
        />
      </div>
    </Section>
  );

  const sectionCompetition = (
    <Section title={t.create.section3}>
      {!competitions ? (
        <p className="text-sm text-muted-foreground">{t.create.loadingCompetitions}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {competitions.map((c) => {
            const pending = isCalendarPendingCompetition(c.slug);
            return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCompetitionId(c.id)}
              className={`text-left p-2.5 sm:p-3 rounded-xl border transition-all min-w-0 ${
                competitionId === c.id
                  ? "border-primary ring-2 ring-primary/20 bg-accent"
                  : "border-border hover:border-primary/40 bg-card"
              }`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <CompetitionBadge name={c.name} logoUrl={c.logo_url} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold truncate text-sm sm:text-base">{c.name}</p>
                    {pending && (
                      <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        {t.create.calendarPendingBadge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                    {formatLabel(c.format)} · {t.home.seasonPrefix} {c.season}
                    {c.country ? ` · ${c.country}` : ""}
                  </p>
                  {pending && competitionId === c.id && (
                    <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 mt-1 leading-snug">
                      {t.create.calendarPendingHint}
                    </p>
                  )}
                </div>
              </div>
            </button>
            );
          })}
        </div>
      )}
    </Section>
  );

  const sectionPoints = (
    <Section title={t.create.section4}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="po">{t.create.pointsOutcome}</Label>
          <NumberInput
            id="po"
            inputMode="numeric"
            min={0}
            value={pointsOutcome}
            onChange={setPointsOutcome}
            className="mt-1.5 h-11 tabular"
          />
        </div>
        <div>
          <Label htmlFor="pe">{t.create.pointsExact}</Label>
          <NumberInput
            id="pe"
            inputMode="numeric"
            min={0}
            value={pointsExact}
            onChange={setPointsExact}
            className="mt-1.5 h-11 tabular"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span className="leading-relaxed">{pointsHint}</span>
      </p>
    </Section>
  );

  const sectionModules = (
    <Section title={t.create.section5}>
      <ModuleCard
        icon={<Sparkles className="w-4 h-4" />}
        title={t.create.special}
        description={
          competitionStarted ? t.create.specialStartedWarn : t.create.specialDesc
        }
        enabled={specialEnabled && !specialsLocked}
        onToggle={setSpecialEnabled}
        disabled={specialsToggleDisabled}
      >
        {specialEnabled && !specialsLocked && (
          <div className="space-y-2">
            {isLeague && (
              <SubToggle
                label={t.create.winner}
                checked={specialWinner}
                onChange={setSpecialWinner}
                value={pointsWinner}
                onValue={setPointsWinner}
                pointsLabel={t.common.points}
              />
            )}
            {isKnockoutish && (
              <div className="rounded-lg border p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={specialSupportTeam}
                    onCheckedChange={setSpecialSupportTeam}
                    aria-label={t.create.supportTeam}
                  />
                  <span className="flex-1 text-sm font-medium">{t.create.supportTeam}</span>
                </div>
                {specialSupportTeam && (
                  <div className="pl-1 space-y-2">
                    <div>
                      <Label className="text-xs">{t.create.supportTeamMode}</Label>
                      <select
                        value={supportTeamMode}
                        onChange={(e) => {
                          const mode =
                            e.target.value === "champion" ? "champion" : "per_phase";
                          setSupportTeamMode(mode);
                          // UCL/EL: champion default 40; per-phase default 2
                          if (isKnockoutish) {
                            setPointsSupportAdvance(mode === "champion" ? 40 : 2);
                          }
                        }}
                        className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
                      >
                        <option value="per_phase">{t.create.supportTeamModePhase}</option>
                        <option value="champion">{t.create.supportTeamModeChampion}</option>
                      </select>
                    </div>
                    <NumberField
                      label={t.create.pointsSupport}
                      value={pointsSupportAdvance}
                      onChange={setPointsSupportAdvance}
                      min={0}
                    />
                    <p className="text-[11px] text-muted-foreground">{supportHint}</p>
                  </div>
                )}
              </div>
            )}
            <div className="rounded-lg border p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={specialTopScorer}
                  onCheckedChange={setSpecialTopScorer}
                  aria-label={t.create.topScorer}
                />
                <span className="flex-1 text-sm font-medium">{t.create.topScorer}</span>
              </div>
              {specialTopScorer && (
                <div className="pl-1 space-y-2">
                  <div>
                    <Label className="text-xs">{t.create.topScorerMode}</Label>
                    <select
                      value={topScorerMode}
                      onChange={(e) =>
                        setTopScorerMode(
                          e.target.value === "per_goal" ? "per_goal" : "player_match",
                        )
                      }
                      className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
                    >
                      <option value="player_match">{t.create.topScorerModeFlat}</option>
                      <option value="per_goal">{t.create.topScorerModePerGoal}</option>
                    </select>
                  </div>
                  {topScorerMode === "per_goal" ? (
                    <NumberField
                      label={t.create.pointsTopScorerPerGoal}
                      value={pointsTopScorerPerGoal}
                      onChange={setPointsTopScorerPerGoal}
                      min={0}
                    />
                  ) : (
                    <NumberField
                      label={t.create.pointsTopScorer}
                      value={pointsTopScorer}
                      onChange={setPointsTopScorer}
                      min={0}
                    />
                  )}
                </div>
              )}
            </div>
            <SubToggle
              label={t.create.bestDefense}
              checked={specialBestDefense}
              onChange={setSpecialBestDefense}
              value={pointsBestDefense}
              onValue={setPointsBestDefense}
              pointsLabel={t.common.points}
            />
          </div>
        )}
      </ModuleCard>

      <ModuleCard
        icon={<Star className="w-4 h-4" />}
        title={t.create.wildcard}
        description={t.create.wildcardDesc}
        enabled={wildcardEnabled}
        onToggle={setWildcardEnabled}
      >
        {wildcardEnabled && (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">{t.create.wcScope}</Label>
              <select
                value={wildcardScope}
                onChange={(e) =>
                  applyWildcardScope(e.target.value === "per_season" ? "per_season" : "per_matchday")
                }
                className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
              >
                <option value="per_matchday">{t.create.wcScopeMatchday}</option>
                <option value="per_season">{t.create.wcScopeSeason}</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">{t.create.wcScopeHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={t.create.wcPerRound}
                value={wildcardPerRound}
                onChange={setWildcardPerRound}
                min={1}
                max={wildcardScope === "per_season" ? Math.max(seasonWildcardQty(matchdayCount), 99) : 5}
              />
              <NumberField
                label={t.create.wcMultiplier}
                value={wildcardMultiplier}
                onChange={setWildcardMultiplier}
                min={1}
                max={10}
                step={0.5}
              />
            </div>
          </div>
        )}
      </ModuleCard>

      <ModuleCard
        icon={<Flame className="w-4 h-4" />}
        title={t.create.streak}
        description={t.create.streakDesc}
        enabled={streakEnabled}
        onToggle={setStreakEnabled}
      >
        {streakEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t.create.streakThreshold}
              value={streakThreshold}
              onChange={setStreakThreshold}
              min={2}
              max={10}
            />
            <NumberField
              label={t.create.streakBonus}
              value={streakBonus}
              onChange={setStreakBonus}
              min={0}
              max={50}
              step={0.5}
            />
          </div>
        )}
      </ModuleCard>
    </Section>
  );

  const sectionPrizes = (
    <Section title={t.create.section6}>
      <PrizesForm value={prizes} onChange={setPrizes} memberCount={1} />
    </Section>
  );

  function renderStep(id: StepId) {
    switch (id) {
      case "info":
        return sectionInfo;
      case "privacy":
        return sectionPrivacy;
      case "competition":
        return sectionCompetition;
      case "points":
        return sectionPoints;
      case "modules":
        return sectionModules;
      case "prizes":
        return sectionPrizes;
    }
  }

  const isLastStep = step >= stepIds.length - 1;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-primary font-semibold">
            {t.create.badge}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display tracking-wide mt-1">{t.create.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.create.subtitle}</p>
          {isMobile && (
            <p className="text-xs text-muted-foreground mt-2 tabular">
              {t.create.stepOf
                .replace("{current}", String(step + 1))
                .replace("{total}", String(stepIds.length))}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Mobile: only explicit Criar button; avoid Enter / double-tap creating early.
            if (isMobile) return;
            void doSubmit();
          }}
          className="space-y-5"
        >
          {isMobile ? (
            <>
              {renderStep(stepIds[step])}
              <div className="pt-1 pb-2 flex gap-2">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 flex-1"
                    disabled={navLocked}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                  >
                    {t.create.backStep}
                  </Button>
                )}
                {isLastStep ? (
                  <Button
                    type="button"
                    className="h-12 flex-1"
                    disabled={navLocked || saving || !name || !competitionId}
                    onClick={() => void doSubmit()}
                  >
                    {saving ? t.create.submitting : t.create.submit}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="h-12 flex-1"
                    disabled={navLocked}
                    onClick={goNext}
                  >
                    {t.create.next}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {sectionInfo}
              {sectionPrivacy}
              {sectionCompetition}
              {sectionPoints}
              {sectionModules}
              {!isPublic && sectionPrizes}
              <div className="pt-1 pb-2">
                <Button
                  type="submit"
                  className="w-full h-12"
                  disabled={saving || !name || !competitionId}
                >
                  {saving ? t.create.submitting : t.create.submit}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-3 sm:p-5 space-y-3 shadow-card overflow-hidden min-w-0">
      <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="min-w-0 space-y-3">{children}</div>
    </Card>
  );
}

function PrivacyCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 sm:p-4 rounded-xl border transition-all min-w-0 ${
        selected
          ? "border-primary ring-2 ring-primary/20 bg-accent"
          : "border-border hover:border-primary/40 bg-card"
      }`}
    >
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <span
          className={`w-7 h-7 rounded-md grid place-items-center shrink-0 ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {icon}
        </span>
        <p className="font-semibold truncate">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{description}</p>
    </button>
  );
}

function ModuleCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${enabled ? "border-primary/40 bg-accent/40" : "border-border"} ${disabled ? "opacity-80" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-8 h-8 rounded-md grid place-items-center shrink-0 ${enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
          aria-label={title}
        />
      </div>
      {children && <div className="mt-3 sm:pl-11 space-y-2 min-w-0">{children}</div>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <NumberInput
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={onChange}
        className="mt-1 h-10 tabular"
      />
      {hint ? <p className="text-[11px] text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

function SubToggle({
  label,
  checked,
  onChange,
  value,
  onValue,
  pointsLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  value: number;
  onValue: (v: number) => void;
  pointsLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <NumberInput
        min={0}
        value={value}
        onChange={onValue}
        disabled={!checked}
        className="w-20 h-9 text-center tabular"
      />
      <span className="text-xs text-muted-foreground">{pointsLabel}</span>
    </div>
  );
}
