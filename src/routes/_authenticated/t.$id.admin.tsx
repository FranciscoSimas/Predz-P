import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { NumberInput } from "@/components/NumberInput";
import { Settings, Copy, Users, Save, ShieldAlert, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PrizesForm, defaultPrizes, type PrizesValue, type CustomPrize } from "@/components/PrizesForm";
import { useT } from "@/lib/i18n";
import { isKnockoutishFormat, isLeagueFormat } from "@/lib/competition-format";

export const Route = createFileRoute("/_authenticated/t/$id/admin")({
  component: AdminPage,
});

type Member = {
  user_id: string;
  role: "owner" | "admin" | "member" | "spectator";
  joined_at: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
};

function AdminPage() {
  const { id } = useParams({ from: "/_authenticated/t/$id/admin" });
  const navigate = useNavigate();
  const { t: tr } = useT();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: tournament, isLoading: tLoad } = useQuery({
    queryKey: ["tournament-admin", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id, name, description, is_public, is_official, join_code, owner_id, competition_id, competition:competitions(name, season, format)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: myMember, isLoading: mLoad } = useQuery({
    queryKey: ["my-role", id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("tournament_members")
        .select("role")
        .eq("tournament_id", id)
        .eq("user_id", me!.id)
        .maybeSingle();
      return data?.role ?? null;
    },
  });

  const { data: isPlatformAdmin, isLoading: paLoad } = useQuery({
    queryKey: ["is-platform-admin"],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", me!.id)
        .maybeSingle();
      return !!data;
    },
  });

  const canAdminister = tournament?.is_official
    ? !!isPlatformAdmin
    : myMember === "owner" || myMember === "admin";

  // Gate — redirect non-admins away (official = platform admin only)
  useEffect(() => {
    if (mLoad || paLoad || tLoad) return;
    if (!canAdminister) {
      toast.error(tr.admin.noAccess);
      navigate({ to: "/t/$id", params: { id } });
    }
  }, [canAdminister, mLoad, paLoad, tLoad, navigate, id, tr.admin.noAccess]);

  if (tLoad || mLoad || paLoad) {
    return (
      <div className="max-w-4xl mx-auto space-y-3">
        <div className="h-8 w-40 bg-muted rounded animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }
  if (!tournament) return null;
  if (!canAdminister) return null;

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
            <Settings className="w-5 h-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-display tracking-wide">{tr.admin.title}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {tournament.name} · {tournament.competition?.name}
          </p>
        </div>
      </div>

      <Tabs defaultValue="general">
        <TabsList className={`grid w-full ${!tournament.is_public && !tournament.is_official ? "grid-cols-4" : "grid-cols-3"}`}>
          <TabsTrigger value="general">{tr.admin.tabGeneral}</TabsTrigger>
          <TabsTrigger value="members">{tr.admin.tabMembers}</TabsTrigger>
          <TabsTrigger value="rules">{tr.admin.tabRules}</TabsTrigger>
          {!tournament.is_public && !tournament.is_official && (
            <TabsTrigger value="prizes">{tr.admin.tabPrizes}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <GeneralTab tournament={tournament} isOwner={me?.id === tournament.owner_id} />
          <DangerZone tournament={tournament} canDelete={canAdminister} />
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          <MembersTab tournamentId={id} ownerId={tournament.owner_id} meId={me?.id ?? ""} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab tournamentId={id} />
        </TabsContent>
        {!tournament.is_public && !tournament.is_official && (
          <TabsContent value="prizes" className="mt-4">
            <PrizesTab tournamentId={id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// GERAL

type TournamentAdmin = {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  is_official: boolean;
  join_code: string;
  owner_id: string;
  competition_id: string;
  competition: { name: string; season: string; format: string } | null;
};

function GeneralTab({ tournament, isOwner }: { tournament: TournamentAdmin; isOwner: boolean }) {
  const qc = useQueryClient();
  const { t: tr } = useT();
  const [name, setName] = useState(tournament.name ?? "");
  const [desc, setDesc] = useState(tournament.description ?? "");
  const [isPublic, setIsPublic] = useState<boolean>(!!tournament.is_public);
  const [saving, setSaving] = useState(false);

  const dirty =
    name.trim() !== (tournament.name ?? "") ||
    (desc ?? "") !== (tournament.description ?? "") ||
    isPublic !== !!tournament.is_public;

  async function save() {
    if (!name.trim()) return toast.error(tr.common.nameRequired);
    setSaving(true);
    const { error } = await supabase
      .from("tournaments")
      .update({
        name: name.trim(),
        description: desc || null,
        is_public: isPublic,
      })
      .eq("id", tournament.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(tr.admin.general.updated);
    qc.invalidateQueries({ queryKey: ["tournament", tournament.id] });
    qc.invalidateQueries({ queryKey: ["tournament-admin", tournament.id] });
  }

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${tournament.join_code}`
      : "";

  return (
    <Card className="p-5 shadow-card space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="t-name">{tr.admin.general.name}</Label>
          <Input
            id="t-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{tr.admin.general.competition}</Label>
          <Input
            value={`${tournament.competition?.name ?? ""} · ${tournament.competition?.season ?? ""}`}
            disabled
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-desc">{tr.admin.general.description}</Label>
        <Textarea
          id="t-desc"
          value={desc ?? ""}
          maxLength={300}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">{tr.admin.general.publicTitle}</p>
          <p className="text-xs text-muted-foreground">
            Aparece em “Explorar”. Qualquer pessoa pode entrar.
          </p>
        </div>
        <Switch checked={isPublic} onCheckedChange={setIsPublic} />
      </div>

      <div className="border-t pt-4 space-y-3">
        <div>
          <Label>{tr.admin.general.joinCode}</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              value={tournament.join_code}
              readOnly
              className="font-mono tabular text-lg font-bold"
            />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(tournament.join_code);
                toast.success(tr.tournament.codeCopied);
              }}
              aria-label={tr.admin.general.copyCodeAria}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {shareUrl && (
          <div>
            <Label>{tr.admin.general.shareLink}</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Input value={shareUrl} readOnly className="text-xs" />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  toast.success(tr.tournament.linkCopied);
                }}
                aria-label={tr.admin.general.copyLinkAria}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? tr.common.saving : tr.common.saveChanges}
        </Button>
      </div>

      {!isOwner && !tournament.is_official && (
        <p className="text-xs text-muted-foreground">
          {tr.admin.general.notOwnerHint}
        </p>
      )}
    </Card>
  );
}

function DangerZone({
  tournament,
  canDelete,
}: {
  tournament: TournamentAdmin;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t: tr } = useT();
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);

  if (!canDelete) return null;

  const nameMatches = confirmName.trim() === tournament.name.trim();
  const d = tr.admin.danger;

  async function handleDelete() {
    if (!nameMatches) return;
    setDeleting(true);
    const { error } = await supabase.from("tournaments").delete().eq("id", tournament.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(d.deleted);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["my-tournaments"] });
    qc.invalidateQueries({ queryKey: ["public-tournaments"] });
    qc.invalidateQueries({ queryKey: ["tournament", tournament.id] });
    navigate({ to: "/home" });
  }

  return (
    <Card className="p-5 shadow-card border-destructive/40 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h2 className="font-bold text-destructive">{d.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{d.desc}</p>
        </div>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-full sm:w-auto">
            <Trash2 className="w-4 h-4 mr-1.5" />
            {d.deleteBtn}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {d.confirmDesc.replace("{name}", tournament.name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="confirm-delete-name">{d.confirmLabel}</Label>
            <Input
              id="confirm-delete-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={tournament.name}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tr.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!nameMatches || deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? d.deleting : d.confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// MEMBROS

function MembersTab({
  tournamentId,
  ownerId,
  meId,
}: {
  tournamentId: string;
  ownerId: string;
  meId: string;
}) {
  const qc = useQueryClient();
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
          profile: {
            display_name: m.display_name,
            avatar_url: m.avatar_url,
          },
        }),
      );
    },
  });

  async function setRole(userId: string, newRole: "admin" | "member") {
    const { error } = await supabase
      .from("tournament_members")
      .update({ role: newRole })
      .eq("tournament_id", tournamentId)
      .eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success(tr.admin.members.roleUpdated);
    qc.invalidateQueries({ queryKey: ["members", tournamentId] });
  }

  async function removeMember(userId: string) {
    const { error } = await supabase
      .from("tournament_members")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success(tr.admin.members.removed);
    qc.invalidateQueries({ queryKey: ["members", tournamentId] });
  }

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

  return (
    <Card className="p-0 shadow-card overflow-hidden">
      <ul className="divide-y">
        {members.map((m) => {
          const isMeOwner = m.user_id === ownerId;
          const initials = (m.profile?.display_name ?? "J")
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? "")
            .join("");
          return (
            <li key={m.user_id} className="p-3 flex items-center gap-3">
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
                <p className="font-medium truncate">
                  {m.profile?.display_name ?? tr.tournament.dashboard.player}
                  {m.user_id === meId && (
                    <span className="text-xs text-muted-foreground font-normal ml-1">(tu)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.role === "spectator" ? tr.join.roleSpectator : roleLabel(m.role)} · desde{" "}
                  {new Date(m.joined_at).toLocaleDateString("pt-PT")}
                </p>
              </div>
              {!isMeOwner && (
                <div className="flex items-center gap-1.5">
                  {m.role === "spectator" ? (
                    <span className="rounded-md bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                      {tr.join.roleSpectator}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => setRole(m.user_id, e.target.value as "admin" | "member")}
                      className="h-9 px-2 rounded-md border bg-background text-sm"
                      aria-label={tr.admin.members.changeRole}
                    >
                      <option value="member">{tr.admin.members.roleMember}</option>
                      <option value="admin">{tr.admin.members.roleAdmin}</option>
                    </select>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={tr.admin.members.removeAria}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{tr.admin.members.removeQ}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {m.profile?.display_name ?? tr.admin.members.thisPlayer} deixa de ter acesso ao
                          torneio. Os prognósticos anteriores permanecem para efeitos de histórico.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tr.common.cancel}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeMember(m.user_id)}>
                          {tr.common.remove}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
              {isMeOwner && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-primary/10 text-primary font-bold">
                  Owner
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function roleLabel(r: string) {
  if (r === "owner") return "Owner";
  if (r === "admin") return "Admin";
  if (r === "spectator") return "Spectator";
  return "Member";
}

// ────────────────────────────────────────────────────────────────────
// REGRAS

function RulesTab({ tournamentId }: { tournamentId: string }) {
  const qc = useQueryClient();
  const { t: tr } = useT();
  const { data: settings, isLoading } = useQuery({
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

  const { data: tourn } = useQuery({
    queryKey: ["tournament-comp", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("competition_id, competition:competitions(format)")
        .eq("id", tournamentId)
        .single();
      if (error) throw error;
      return data as unknown as {
        competition_id: string;
        competition: { format: string } | null;
      };
    },
  });

  const compFormat = tourn?.competition?.format;
  const isLeague = isLeagueFormat(compFormat);
  const isKnockoutish = isKnockoutishFormat(compFormat);

  const { data: startedMatches } = useQuery({
    queryKey: ["started-check", tourn?.competition_id],
    enabled: !!tourn?.competition_id,
    queryFn: async () => {
      const { data: byStatus, error: statusErr } = await supabase
        .from("matches")
        .select("id")
        .eq("competition_id", tourn!.competition_id)
        .in("status", ["live", "finished"])
        .limit(1);
      if (statusErr) throw statusErr;
      if ((byStatus?.length ?? 0) > 0) return byStatus ?? [];

      const { data: byKickoff, error: kickErr } = await supabase
        .from("matches")
        .select("id")
        .eq("competition_id", tourn!.competition_id)
        .lte("kickoff_at", new Date().toISOString())
        .limit(1);
      if (kickErr) throw kickErr;
      return byKickoff ?? [];
    },
  });

  const { data: firstKickoff } = useQuery({
    queryKey: ["first-kickoff", tourn?.competition_id],
    enabled: !!tourn?.competition_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("kickoff_at")
        .eq("competition_id", tourn!.competition_id)
        .order("kickoff_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.kickoff_at ?? null;
    },
  });

  const started = (startedMatches?.length ?? 0) > 0;
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const next = { ...(settings as unknown as Record<string, unknown>) };
    if (!next.special_bets_cutoff_at && firstKickoff) {
      next.special_bets_cutoff_at = firstKickoff;
    }
    setForm(next);
  }, [settings, firstKickoff]);

  if (isLoading || !settings) return <div className="h-40 bg-muted rounded-xl animate-pulse" />;

  function set<K extends string>(k: K, v: unknown) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }
  const g = <T,>(k: string, def: T): T => (form[k] as T) ?? def;

  const dirty = JSON.stringify(form) !== JSON.stringify({
    ...(settings as unknown as Record<string, unknown>),
    ...(!settings.special_bets_cutoff_at && firstKickoff
      ? { special_bets_cutoff_at: firstKickoff }
      : {}),
  });

  async function save() {
    if (started) {
      return toast.error(tr.admin.rules.startedWarn);
    }
    setSaving(true);
    const payload: Record<string, unknown> = {};
    // Só campos que existem em tournament_settings
    const allowed = [
      "points_outcome",
      "points_exact_bonus",
      "wildcard_enabled",
      "wildcard_per_round",
      "wildcard_multiplier",
      "wildcard_scope",
      "win_streak_enabled",
      "win_streak_threshold",
      "win_streak_bonus",
      "win_streak_mode",
      "special_bets_enabled",
      "special_bet_winner_enabled",
      "special_bet_support_team_enabled",
      "special_bet_top_scorer_enabled",
      "special_bet_best_defense_enabled",
      "points_winner",
      "points_support_advance",
      "support_team_mode",
      "points_top_scorer",
      "points_best_defense",
      "points_top_scorer_per_goal",
      "top_scorer_mode",
      "special_bets_cutoff_at",
    ];
    for (const k of allowed) payload[k] = form[k];
    // Gate format-specific bets on save
    if (!isLeague) payload.special_bet_winner_enabled = false;
    if (!isKnockoutish) payload.special_bet_support_team_enabled = false;
    let { error } = await supabase
      .from("tournament_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(payload as any)
      .eq("tournament_id", tournamentId);
    if (error?.message?.includes("support_team_mode")) {
      const { support_team_mode: _omit, ...rest } = payload;
      const retry = await supabase
        .from("tournament_settings")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(rest as any)
        .eq("tournament_id", tournamentId);
      error = retry.error;
      if (!retry.error) {
        toast.warning("Regras gravadas. Aplica a migration support_team_mode no Supabase para o modo Campeão.");
      }
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(tr.admin.rules.updated);
    qc.invalidateQueries({ queryKey: ["settings", tournamentId] });
    qc.invalidateQueries({ queryKey: ["leaderboard", tournamentId] });
  }

  const topScorerMode = g("top_scorer_mode", "player_match");

  return (
    <div className="space-y-4 pb-24 sm:pb-0">
      {started && (
        <Card className="p-3 shadow-card bg-amber-500/10 border-amber-500/40 text-sm">
          {tr.admin.rules.startedWarn}
        </Card>
      )}

      <RuleSection title={tr.admin.rules.base} locked={started}>
        <div className="grid grid-cols-2 gap-3">
          <NumField label={tr.admin.rules.pointsOutcome} value={g("points_outcome", 2)} onChange={(v) => set("points_outcome", v)} disabled={started} />
          <NumField label={tr.admin.rules.pointsExactBonus} value={g("points_exact_bonus", 3)} onChange={(v) => set("points_exact_bonus", v)} disabled={started} />
        </div>
      </RuleSection>

      <RuleSection title={tr.admin.rules.wildcardSection} locked={started}>
        <ToggleRow label={tr.admin.rules.wcActivate} value={g("wildcard_enabled", false)} onChange={(v) => set("wildcard_enabled", v)} disabled={started} />
        {g("wildcard_enabled", false) && (
          <div className="mt-2 space-y-3 rounded-lg border border-primary/20 bg-accent/30 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <NumField label={tr.admin.rules.wcPerPeriod} value={g("wildcard_per_round", 1)} onChange={(v) => set("wildcard_per_round", v)} disabled={started} />
                <p className="text-[11px] text-muted-foreground mt-1">{tr.admin.rules.wcHintCount}</p>
              </div>
              <div>
                <NumField
                  label={tr.admin.rules.wcMultiplier}
                  value={g("wildcard_multiplier", 2)}
                  onChange={(v) => set("wildcard_multiplier", v)}
                  disabled={started}
                  min={1}
                  max={10}
                  step={0.5}
                />
                <p className="text-[11px] text-muted-foreground mt-1">{tr.admin.rules.wcHintMultiplier}</p>
              </div>
              <div>
                <Label className="text-xs">{tr.admin.rules.wcScope}</Label>
                <select
                  value={g("wildcard_scope", "per_matchday")}
                  onChange={(e) => set("wildcard_scope", e.target.value)}
                  disabled={started}
                  className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
                >
                  <option value="per_matchday">{tr.admin.rules.scopeMatchday}</option>
                  <option value="per_season">{tr.admin.rules.scopeSeason}</option>
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">{tr.admin.rules.wcHintScope}</p>
              </div>
            </div>
          </div>
        )}
      </RuleSection>

      <RuleSection title={tr.admin.rules.streakSection} locked={started}>
        <ToggleRow label={tr.admin.rules.streakActivate} value={g("win_streak_enabled", false)} onChange={(v) => set("win_streak_enabled", v)} disabled={started} />
        {g("win_streak_enabled", false) && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <NumField label={tr.admin.rules.streakThreshold} value={g("win_streak_threshold", 3)} onChange={(v) => set("win_streak_threshold", v)} disabled={started} />
              <div>
                <NumField
                  label={tr.admin.rules.streakBonus}
                  value={g("win_streak_bonus", 2)}
                  onChange={(v) => set("win_streak_bonus", v)}
                  disabled={started}
                  min={0}
                  max={100}
                  step={0.5}
                />
                <p className="text-[11px] text-muted-foreground mt-1">{tr.admin.rules.streakBonusHint}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{tr.admin.rules.streakHint}</p>
          </div>
        )}
      </RuleSection>

      <RuleSection title={tr.admin.rules.specialSection} locked={started}>
        {started && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-2">
            {tr.admin.rules.specialStartedWarn}
          </p>
        )}
        <ToggleRow label={tr.admin.rules.specialActivate} value={g("special_bets_enabled", false)} onChange={(v) => set("special_bets_enabled", v)} disabled={started} />
        {g("special_bets_enabled", false) && (
          <div className="space-y-2 mt-2">
            {isLeague && (
              <SubSpecial label={tr.admin.rules.winner} enabled={g("special_bet_winner_enabled", true)} onEnabled={(v) => set("special_bet_winner_enabled", v)} points={g("points_winner", 20)} onPoints={(v) => set("points_winner", v)} disabled={started} />
            )}
            {isKnockoutish && (
              <div className="rounded-lg border p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={g("special_bet_support_team_enabled", false)}
                    onCheckedChange={(v) => set("special_bet_support_team_enabled", v)}
                    disabled={started}
                  />
                  <span className="flex-1 text-sm font-medium">{tr.admin.rules.supportTeam}</span>
                </div>
                {g("special_bet_support_team_enabled", false) && (
                  <div className="space-y-2 pl-1">
                    <div>
                      <Label className="text-xs">{tr.admin.rules.supportTeamMode}</Label>
                      <select
                        value={g("support_team_mode", "per_phase") === "champion" ? "champion" : "per_phase"}
                        onChange={(e) =>
                          set("support_team_mode", e.target.value === "champion" ? "champion" : "per_phase")
                        }
                        disabled={started}
                        className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
                      >
                        <option value="per_phase">{tr.admin.rules.supportTeamModePhase}</option>
                        <option value="champion">{tr.admin.rules.supportTeamModeChampion}</option>
                      </select>
                    </div>
                    <NumField
                      label={tr.admin.rules.pointsSupport}
                      value={g("points_support_advance", 3)}
                      onChange={(v) => set("points_support_advance", v)}
                      disabled={started}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {(g("support_team_mode", "per_phase") === "champion"
                        ? tr.admin.rules.supportTeamHintChampion
                        : tr.admin.rules.supportTeamHint
                      ).replaceAll("{x}", String(g("points_support_advance", 3)))}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="rounded-lg border p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={g("special_bet_top_scorer_enabled", true)}
                  onCheckedChange={(v) => set("special_bet_top_scorer_enabled", v)}
                  disabled={started}
                />
                <span className="flex-1 text-sm font-medium">{tr.admin.rules.topScorerName}</span>
              </div>
              {g("special_bet_top_scorer_enabled", true) && (
                <div className="space-y-2 pl-1">
                  <div>
                    <Label className="text-xs">{tr.admin.rules.topScorerMode}</Label>
                    <select
                      value={topScorerMode}
                      onChange={(e) => set("top_scorer_mode", e.target.value)}
                      disabled={started}
                      className="w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm mt-1"
                    >
                      <option value="player_match">{tr.admin.rules.topScorerModeFlat}</option>
                      <option value="per_goal">{tr.admin.rules.topScorerModePerGoal}</option>
                    </select>
                  </div>
                  {topScorerMode === "per_goal" ? (
                    <NumField label={tr.admin.rules.pointsTopScorerPerGoal} value={g("points_top_scorer_per_goal", 1)} onChange={(v) => set("points_top_scorer_per_goal", v)} disabled={started} />
                  ) : (
                    <NumField label={tr.admin.rules.pointsTopScorer} value={g("points_top_scorer", 20)} onChange={(v) => set("points_top_scorer", v)} disabled={started} />
                  )}
                </div>
              )}
            </div>
            <SubSpecial label={tr.admin.rules.bestDefense} enabled={g("special_bet_best_defense_enabled", false)} onEnabled={(v) => set("special_bet_best_defense_enabled", v)} points={g("points_best_defense", 15)} onPoints={(v) => set("points_best_defense", v)} disabled={started} />
            <div>
              <Label className="text-xs">{tr.admin.rules.cutoff}</Label>
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <Input
                  type="datetime-local"
                  value={toLocalInput(g<string | null>("special_bets_cutoff_at", null))}
                  onChange={(e) => set("special_bets_cutoff_at", e.target.value ? new Date(e.target.value).toISOString() : null)}
                  disabled={started}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-10"
                  disabled={started || !firstKickoff}
                  onClick={() => firstKickoff && set("special_bets_cutoff_at", firstKickoff)}
                >
                  {tr.admin.rules.cutoffUseFirstKickoff}
                </Button>
              </div>
            </div>
          </div>
        )}
      </RuleSection>

      <div className="pb-28 sm:pb-2">
      <div
        className="fixed inset-x-0 z-20 px-4 sm:static sm:inset-auto sm:px-0 sm:z-10"
        style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto max-w-4xl bg-card border shadow-card rounded-xl p-2 flex items-center gap-2 sm:sticky sm:bottom-4">
          <div className="flex-1 px-2 text-sm min-w-0">
            {started ? (
              <span className="text-muted-foreground">{tr.admin.rules.locked}</span>
            ) : dirty ? (
              <span className="font-medium">{tr.common.unsaved}</span>
            ) : (
              <span className="text-muted-foreground">{tr.common.allSaved}</span>
            )}
          </div>
          <Button onClick={save} disabled={started || !dirty || saving} className="h-11 shrink-0 min-w-[8.5rem] sm:min-w-[10rem]">
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? tr.common.saving : tr.admin.rules.saveRules}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RuleSection({
  title,
  locked,
  children,
}: {
  title: string;
  locked: boolean;
  children: React.ReactNode;
}) {
  const { t: tr } = useT();
  return (
    <Card className="p-4 shadow-card space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{title}</h3>
        {locked && (
          <span
            className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground inline-flex items-center gap-1"
            title={tr.admin.rules.lockedTitle}
          >
            <ShieldAlert className="w-3 h-3" /> {tr.admin.rules.locked}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-2.5">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <NumberInput
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="mt-1 h-10 tabular"
      />
    </div>
  );
}

function SubSpecial({
  label,
  enabled,
  onEnabled,
  points,
  onPoints,
  disabled,
}: {
  label: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  points: number;
  onPoints: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      <Switch checked={enabled} onCheckedChange={onEnabled} disabled={disabled} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <NumberInput
        min={0}
        value={points}
        onChange={onPoints}
        disabled={disabled || !enabled}
        className="w-20 h-9 text-center tabular"
      />
      <span className="text-xs text-muted-foreground">pts</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// PRÉMIOS

function PrizesTab({ tournamentId }: { tournamentId: string }) {
  const qc = useQueryClient();
  const { t: tr } = useT();

  const { data: settings, isLoading } = useQuery({
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

  const { data: memberCount } = useQuery({
    queryKey: ["member-count", tournamentId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tournament_members")
        .select("user_id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId);
      if (error) throw error;
      return count ?? 1;
    },
  });

  const [form, setForm] = useState<PrizesValue>(defaultPrizes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const custom = Array.isArray(settings.prize_custom)
      ? (settings.prize_custom as unknown as CustomPrize[])
      : [];
    setForm({
      prizes_enabled: !!settings.prizes_enabled,
      prize_entry_amount: Number(settings.prize_entry_amount ?? 0),
      prize_entry_currency: settings.prize_entry_currency ?? "EUR",
      prize_pct_first: settings.prize_pct_first ?? 60,
      prize_pct_second: settings.prize_pct_second ?? 30,
      prize_pct_third: settings.prize_pct_third ?? 10,
      prize_custom: custom,
    });
  }, [settings]);

  if (isLoading || !settings)
    return <div className="h-40 bg-muted rounded-xl animate-pulse" />;

  const pctSum = form.prize_pct_first + form.prize_pct_second + form.prize_pct_third;
  const invalid =
    form.prizes_enabled && form.prize_entry_amount > 0 && pctSum !== 100;

  async function save() {
    if (invalid) return toast.error(tr.prizes.sumMust100);
    setSaving(true);
    const { error } = await supabase
      .from("tournament_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        prizes_enabled: form.prizes_enabled,
        prize_entry_amount: form.prize_entry_amount,
        prize_entry_currency: form.prize_entry_currency,
        prize_pct_first: form.prize_pct_first,
        prize_pct_second: form.prize_pct_second,
        prize_pct_third: form.prize_pct_third,
        prize_custom: form.prize_custom,
      } as any)
      .eq("tournament_id", tournamentId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(tr.prizes.saved);
    qc.invalidateQueries({ queryKey: ["settings", tournamentId] });
    qc.invalidateQueries({ queryKey: ["prizes", tournamentId] });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">{tr.prizes.title}</h2>
        <p className="text-sm text-muted-foreground">{tr.prizes.subtitle}</p>
      </div>
      <PrizesForm value={form} onChange={setForm} memberCount={memberCount ?? 1} />
      <div className="pb-28 sm:pb-2">
      <div
        className="fixed inset-x-0 z-20 px-4 sm:static sm:inset-auto sm:px-0"
        style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <Button onClick={save} disabled={saving || invalid} className="w-full h-11 shadow-card sm:sticky sm:bottom-4">
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? tr.common.saving : tr.prizes.save}
        </Button>
      </div>
      </div>
    </div>
  );
}
