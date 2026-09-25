import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import {
  Info,
  Copy,
  Users,
  LogOut,
  ArrowLeft,
  Star,
  Sparkles,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useT, fmt as interp } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/t/$id/info")({
  component: InfoPage,
});

type Member = {
  user_id: string;
  role: "owner" | "admin" | "member" | "spectator";
  joined_at: string;
  withdrawn_at: string | null;
  profile: { display_name: string | null; avatar_url: string | null } | null;
};

function InfoPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/info" });
  const { t: tr } = useT();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: tournament, isLoading } = useQuery({
    queryKey: ["tournament-info", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id, name, description, is_public, is_official, join_code, owner_id, competition:competitions(name, season, format)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as {
        id: string;
        name: string;
        description: string | null;
        is_public: boolean;
        is_official: boolean;
        join_code: string;
        owner_id: string;
        competition: { name: string; season: string; format: string } | null;
      };
    },
  });

  const { data: myMembership } = useQuery({
    queryKey: ["my-membership", id, me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_members")
        .select("role, withdrawn_at")
        .eq("tournament_id", id)
        .eq("user_id", me!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-40 bg-muted rounded animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }
  if (!tournament) return null;

  const isOwner = me?.id === tournament.owner_id;
  const isSpectator = myMembership?.role === "spectator";
  const canLeave = !isOwner && !!me?.id;
  const canWithdraw =
    !isOwner &&
    !isSpectator &&
    !!me?.id &&
    !tournament.is_public &&
    !tournament.is_official;
  const alreadyWithdrawn = !!myMembership?.withdrawn_at;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label={tr.tournament.backAria}>
          <Link to="/t/$id" params={{ id }}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-display tracking-wide">{tr.info.title}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {tournament.name} · {tournament.competition?.name}
          </p>
        </div>
      </div>

      {alreadyWithdrawn && (
        <Card className="p-4 border-destructive/50 bg-destructive/10 text-sm text-destructive">
          {tr.info.withdrawnStatus}
        </Card>
      )}

      <Tabs defaultValue="general">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">{tr.info.tabGeneral}</TabsTrigger>
          <TabsTrigger value="members">{tr.info.tabMembers}</TabsTrigger>
          <TabsTrigger value="rules">{tr.info.tabRules}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <GeneralView tournament={tournament} />
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          <MembersView tournamentId={id} ownerId={tournament.owner_id} meId={me?.id ?? ""} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesView tournamentId={id} />
        </TabsContent>
      </Tabs>

      {canWithdraw && !alreadyWithdrawn && me?.id && (
        <WithdrawTournament tournamentId={id} tournamentName={tournament.name} />
      )}
      {canLeave && me?.id && (
        <LeaveTournament
          tournamentId={id}
          tournamentName={tournament.name}
          userId={me.id}
        />
      )}
    </div>
  );
}

function GeneralView({
  tournament,
}: {
  tournament: {
    name: string;
    description: string | null;
    is_public: boolean;
    is_official: boolean;
    join_code: string;
    competition: { name: string; season: string; format: string } | null;
  };
}) {
  const { t: tr } = useT();
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${tournament.join_code}`
      : "";

  function copy(text: string, ok: string) {
    navigator.clipboard.writeText(text);
    toast.success(ok);
  }

  return (
    <Card className="p-5 shadow-card space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {tr.admin.general.name}
        </p>
        <p className="text-lg font-semibold mt-0.5">{tournament.name}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {tr.admin.general.competition}
        </p>
        <p className="text-sm mt-0.5">
          {tournament.competition?.name ?? "-"}
          {tournament.competition?.season ? ` · ${tournament.competition.season}` : ""}
        </p>
      </div>
      {tournament.description && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {tr.admin.general.description}
          </p>
          <p className="text-sm mt-0.5 whitespace-pre-wrap">{tournament.description}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {tournament.is_official ? (
          <span className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary font-semibold">
            {tr.tournament.official}
          </span>
        ) : tournament.is_public ? (
          <span className="text-xs px-2 py-1 rounded-md bg-accent text-accent-foreground font-semibold">
            {tr.tournament.public}
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground font-semibold">
            {tr.tournament.private}
          </span>
        )}
      </div>
      {!tournament.is_official && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3 space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {tr.admin.general.joinCode}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-base font-bold tracking-widest tabular">{tournament.join_code}</code>
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr.admin.general.copyCodeAria}
                onClick={() => copy(tournament.join_code, tr.toasts.codeCopied)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {tr.admin.general.shareLink}
            </p>
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-xs text-muted-foreground truncate flex-1">{shareUrl}</p>
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr.admin.general.copyLinkAria}
                onClick={() => copy(shareUrl, tr.toasts.linkCopied)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function MembersView({
  tournamentId,
  ownerId,
  meId,
}: {
  tournamentId: string;
  ownerId: string;
  meId: string;
}) {
  const { t: tr } = useT();
  const { data: members, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["members", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_tournament_members", {
        _tournament_id: tournamentId,
      });
      if (error) throw error;
      return (data ?? []).map(
        (m): Member => ({
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          withdrawn_at: m.withdrawn_at,
          profile: {
            display_name: m.display_name,
            avatar_url: m.avatar_url,
          },
        }),
      );
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          {(error as Error)?.message ?? tr.admin.members.empty}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          {tr.common.retry}
        </Button>
      </Card>
    );
  }
  if (!members || members.length === 0) {
    return (
      <EmptyState
        icon={<Users className="w-7 h-7" />}
        title={tr.admin.members.empty}
        description={tr.admin.members.emptyDesc}
      />
    );
  }

  const sorted = [...members].sort((a, b) => {
    const rank = (r: Member["role"], userId: string) => {
      if (userId === ownerId || r === "owner") return 0;
      if (r === "admin") return 1;
      return 2;
    };
    return rank(a.role, a.user_id) - rank(b.role, b.user_id);
  });

  return (
    <Card className="p-0 shadow-card overflow-hidden">
      <ul className="divide-y">
        {sorted.map((m) => {
          const isOwner = m.user_id === ownerId || m.role === "owner";
          const isAdmin = isOwner || m.role === "admin";
          const initials = (m.profile?.display_name ?? "J")
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? "")
            .join("");
          return (
            <li
              key={m.user_id}
              className={`p-3 flex items-center gap-3 ${
                m.withdrawn_at ? "bg-destructive/10" : ""
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-accent text-primary grid place-items-center font-bold shrink-0 overflow-hidden">
                {m.profile?.avatar_url ? (
                  <img
                    src={m.profile.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-medium truncate ${m.withdrawn_at ? "text-destructive" : ""}`}>
                  {m.profile?.display_name ?? tr.tournament.dashboard.player}
                  {m.user_id === meId && (
                    <span className="text-xs text-muted-foreground font-normal ml-1">
                      {tr.admin.members.you}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tr.admin.members.since}{" "}
                  {new Date(m.joined_at).toLocaleDateString()}
                </p>
              </div>
              {m.withdrawn_at ? (
                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-destructive text-destructive-foreground font-bold">
                  {tr.info.withdrawnBadge}
                </span>
              ) : m.role === "spectator" ? (
                <span className="rounded bg-sky-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                  {tr.join.roleSpectator}
                </span>
              ) : isAdmin ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold ${
                    isOwner
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  {isOwner ? tr.admin.members.roleOwner : tr.admin.members.roleAdmin}
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground font-semibold">
                  {tr.admin.members.roleMember}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RulesView({ tournamentId }: { tournamentId: string }) {
  const { t } = useT();
  const h = t.ranking.how;

  const { data: s, isLoading } = useQuery({
    queryKey: ["settings", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_settings")
        .select("*")
        .eq("tournament_id", tournamentId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div className="h-40 rounded-xl bg-muted animate-pulse" />;
  }

  return (
    <div className="space-y-3 text-sm">
      <Card className="p-4 shadow-card space-y-1">
        <p className="font-semibold">{h.outcome}</p>
        <p className="text-muted-foreground">
          {h.outcomeDesc}{" "}
          <b className="text-primary">
            {s?.points_outcome ?? "…"} {t.common.points}
          </b>
          .
        </p>
      </Card>
      <Card className="p-4 shadow-card space-y-1">
        <p className="font-semibold">{h.exactBonus}</p>
        <p className="text-muted-foreground">
          {h.exactBonusDesc}{" "}
          <b className="text-primary">
            +{s?.points_exact_bonus ?? "…"} {t.common.points}
          </b>
          .
        </p>
      </Card>
      {s?.wildcard_enabled && (
        <Card className="p-4 shadow-card border-gold/40 bg-gold/5 space-y-1">
          <p className="font-semibold inline-flex items-center gap-1.5">
            <Star className="w-4 h-4 text-gold fill-current" /> {h.wildcard}
          </p>
          <p className="text-muted-foreground">
            {s.wildcard_per_round} {h.wildcardLine1}{" "}
            {s.wildcard_scope === "per_season"
              ? t.predictions.perSeason
              : t.predictions.perMatchday}
            . {h.wildcardLine2}
            <b className="text-gold ml-0.5">{s.wildcard_multiplier}</b>.
          </p>
        </Card>
      )}
      {s?.win_streak_enabled && (
        <Card className="p-4 shadow-card border-orange-500/40 bg-orange-500/5 space-y-1">
          <p className="font-semibold">{h.streak}</p>
          <p className="text-muted-foreground">
            {h.streakLine1} <b>{s.win_streak_threshold}</b> {h.streakLine2}{" "}
            <b className="text-orange-600 dark:text-orange-300">
              +{s.win_streak_bonus} {t.common.points}
            </b>
            .
          </p>
          <p className="text-xs text-muted-foreground">{h.streakExtra}</p>
        </Card>
      )}
      {s?.special_bets_enabled && (
        <Card className="p-4 shadow-card border-primary/40 bg-primary/5 space-y-1">
          <p className="font-semibold inline-flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" /> {h.special}
          </p>
          <ul className="text-muted-foreground text-xs mt-1 space-y-0.5">
            {s.special_bet_winner_enabled && (
              <li>
                • {h.winnerLine} {s.points_winner} {t.common.points}
              </li>
            )}
            {s.special_bet_support_team_enabled && (
              <li>
                • {h.supportTeamLine}{" "}
                {interp(
                  s.support_team_mode === "champion"
                    ? h.supportTeamChampionExtra
                    : h.supportTeamExtra,
                  { x: s.points_support_advance },
                )}
              </li>
            )}
            {s.special_bet_top_scorer_enabled && (
              <li>
                •{" "}
                {s.top_scorer_mode === "per_goal"
                  ? `${h.topScorerPerGoalLine} ${s.points_top_scorer_per_goal}`
                  : `${h.topScorerLine} ${s.points_top_scorer}`}{" "}
                {t.common.points}
              </li>
            )}
            {s.special_bet_best_defense_enabled && (
              <li>
                • {h.bestDefenseLine} {s.points_best_defense} {t.common.points}
              </li>
            )}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted-foreground px-1">{h.tiebreak}</p>
    </div>
  );
}

function WithdrawTournament({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const { t: tr } = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    setBusy(true);
    const { error } = await supabase.rpc("withdraw_from_tournament", {
      _tournament_id: tournamentId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tr.info.withdrawnOk);
    qc.invalidateQueries({ queryKey: ["my-membership", tournamentId] });
    qc.invalidateQueries({ queryKey: ["members", tournamentId] });
    qc.invalidateQueries({ queryKey: ["leaderboard", tournamentId] });
  }

  return (
    <Card className="p-5 shadow-card border-destructive/40 space-y-3">
      <div>
        <h3 className="font-bold text-destructive">{tr.info.withdrawTitle}</h3>
        <p className="text-sm text-muted-foreground mt-1">{tr.info.withdrawDesc}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-full sm:w-auto" disabled={busy}>
            <LogOut className="w-4 h-4 mr-1.5" />
            {busy ? tr.info.withdrawing : tr.info.withdrawBtn}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr.info.withdrawConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interp(tr.info.withdrawConfirmDesc, { name: tournamentName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={withdraw}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr.info.withdrawConfirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LeaveTournament({
  tournamentId,
  tournamentName,
  userId,
}: {
  tournamentId: string;
  tournamentName: string;
  userId: string;
}) {
  const { t: tr } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    const { error } = await supabase
      .from("tournament_members")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("user_id", userId);
    setLeaving(false);
    if (error) return toast.error(error.message);
    toast.success(tr.info.leftOk);
    qc.invalidateQueries({ queryKey: ["my-tournaments"] });
    qc.invalidateQueries({ queryKey: ["members", tournamentId] });
    navigate({ to: "/home" });
  }

  return (
    <Card className="p-5 shadow-card border-destructive/40 space-y-3">
      <div>
        <h3 className="font-bold text-destructive">{tr.info.leaveTitle}</h3>
        <p className="text-sm text-muted-foreground mt-1">{tr.info.leaveDesc}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-full sm:w-auto" disabled={leaving}>
            <LogOut className="w-4 h-4 mr-1.5" />
            {leaving ? tr.info.leaving : tr.info.leaveBtn}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr.info.leaveConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interp(tr.info.leaveConfirmDesc, { name: tournamentName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={leave}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr.info.leaveConfirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
