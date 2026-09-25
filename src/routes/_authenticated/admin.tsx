import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  Trophy,
  Users,
  ClipboardList,
  Activity,
  ExternalLink,
  Search,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { OfficialBadge } from "@/components/OfficialBadge";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { phaseRoundLabelEn, phaseRoundLabelPt } from "@/lib/knockout-aggregate";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  component: PlatformAdminPage,
});

type TournamentRow = {
  id: string;
  name: string;
  is_public: boolean;
  is_official: boolean;
  join_code: string;
  created_at: string;
  owner_id: string;
  competition: { name: string; season: string; logo_url: string | null } | null;
};

type LiveMatch = {
  id: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  competition: { name: string; logo_url: string | null } | null;
  home_team: { name: string; short_name: string | null } | null;
  away_team: { name: string; short_name: string | null } | null;
};

type CompetitionOption = {
  id: string;
  name: string;
  season: string;
  logo_url: string | null;
  is_active: boolean;
};

type EditableMatch = {
  id: string;
  kickoff_at: string;
  status: "scheduled" | "live" | "finished";
  home_score: number | null;
  away_score: number | null;
  et_home_score: number | null;
  et_away_score: number | null;
  pen_home_score: number | null;
  pen_away_score: number | null;
  manual_override: boolean;
  round_or_matchday: number | null;
  phase: string | null;
  home_team: { name: string; short_name: string | null } | null;
  away_team: { name: string; short_name: string | null } | null;
};

type RoundOption = {
  key: string;
  round: number | null;
  phase: string | null;
  label: string;
};

type UniqueUser = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  count: number;
};

function roundKey(round: number | null, phase: string | null) {
  return `r:${round ?? "x"}|p:${phase ?? ""}`;
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function PlatformAdminPage() {
  const navigate = useNavigate();
  const { t: tr, dateLocale, locale } = useT();
  const pa = tr.platformAdmin;
  const [q, setQ] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: isPlatformAdmin, isLoading: paLoad } = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data, error } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  useEffect(() => {
    if (paLoad) return;
    if (!isPlatformAdmin) {
      toast.error(pa.noAccess);
      navigate({ to: "/home" });
    }
  }, [isPlatformAdmin, paLoad, navigate, pa.noAccess]);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: tournaments = [], isLoading: tLoad } = useQuery({
    queryKey: ["platform-admin-tournaments"],
    enabled: !!isPlatformAdmin,
    queryFn: async (): Promise<TournamentRow[]> => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id, name, is_public, is_official, join_code, created_at, owner_id, competition:competitions(name, season, logo_url)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as TournamentRow[];
    },
  });

  const { data: platformUsers = [], isLoading: mLoad } = useQuery({
    queryKey: ["platform-admin-users"],
    enabled: !!isPlatformAdmin,
    queryFn: async (): Promise<UniqueUser[]> => {
      const { data, error } = await supabase.rpc("platform_admin_list_users");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        user_id: row.user_id,
        name: row.display_name?.trim() || row.user_id.slice(0, 8),
        avatar_url: row.avatar_url,
        count: Number(row.tournament_count ?? 0),
      }));
    },
  });

  const { data: liveMatches = [], isLoading: liveLoad } = useQuery({
    queryKey: ["platform-admin-live-matches"],
    enabled: !!isPlatformAdmin,
    refetchInterval: 60_000,
    queryFn: async (): Promise<LiveMatch[]> => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, kickoff_at, status, home_score, away_score, competition:competitions(name, logo_url), home_team:competition_teams!matches_home_team_id_fkey(name, short_name), away_team:competition_teams!matches_away_team_id_fkey(name, short_name)",
        )
        .in("status", ["live", "scheduled"])
        .gte("kickoff_at", new Date(Date.now() - 3 * 3600_000).toISOString())
        .lte("kickoff_at", new Date(Date.now() + 6 * 3600_000).toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as unknown as LiveMatch[];
    },
  });

  const { data: syncState } = useQuery({
    queryKey: ["platform-admin-sync-state"],
    enabled: !!isPlatformAdmin,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_matchday_state")
        .select("last_reason, last_poll_at, last_dispatch_at, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const myTournaments = useMemo(
    () => tournaments.filter((t) => me && t.owner_id === me.id),
    [tournaments, me],
  );

  const activeOfficial = useMemo(
    () => tournaments.filter((t) => t.is_official),
    [tournaments],
  );

  const uniqueUsers = useMemo(
    () =>
      [...platformUsers].sort((a, b) => a.name.localeCompare(b.name, dateLocale)),
    [platformUsers, dateLocale],
  );

  const selectedUser = useMemo(
    () => uniqueUsers.find((u) => u.user_id === selectedUserId) ?? null,
    [uniqueUsers, selectedUserId],
  );

  const filteredTournaments = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tournaments;
    return tournaments.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.join_code.toLowerCase().includes(needle) ||
        (t.competition?.name ?? "").toLowerCase().includes(needle),
    );
  }, [tournaments, q]);

  const filteredUsers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return uniqueUsers;
    return uniqueUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(needle) ||
        u.user_id.toLowerCase().includes(needle),
    );
  }, [uniqueUsers, q]);

  if (paLoad || !isPlatformAdmin) {
    return (
      <AppShell>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </AppShell>
    );
  }

  const fmt = (iso: string | null | undefined) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString(dateLocale, {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  };

  return (
    <AppShell>
      <section className="rounded-2xl overflow-hidden border bg-card p-5 sm:p-6 shadow-card">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-display tracking-wide truncate">
              {pa.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{pa.subtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
          <StatCard label={pa.statTournaments} value={tournaments.length} />
          <StatCard label={pa.statOfficial} value={activeOfficial.length} />
          <StatCard label={pa.statUsers} value={uniqueUsers.length} />
          <StatCard label={pa.statLive} value={liveMatches.filter((m) => m.status === "live").length} />
        </div>
      </section>

      <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={pa.searchPlaceholder}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs defaultValue="tournaments" className="mt-4">
        <TabsList className="w-full sm:w-auto flex flex-wrap h-auto gap-1">
          <TabsTrigger value="tournaments">{pa.tabTournaments}</TabsTrigger>
          <TabsTrigger value="mine">{pa.tabMine}</TabsTrigger>
          <TabsTrigger value="results">{pa.tabResults}</TabsTrigger>
          <TabsTrigger value="users">{pa.tabUsers}</TabsTrigger>
          <TabsTrigger value="tools">{pa.tabTools}</TabsTrigger>
        </TabsList>

        <TabsContent value="tournaments" className="mt-3 space-y-2">
          {tLoad ? (
            <SkeletonList />
          ) : filteredTournaments.length === 0 ? (
            <EmptyState icon={<Trophy className="w-7 h-7" />} title={pa.emptyTournaments} />
          ) : (
            filteredTournaments.map((t) => (
              <TournamentCard
                key={t.id}
                t={t}
                fmt={fmt}
                openLabel={tr.common.open}
                adminLabel={tr.nav.admin}
                publicLabel={tr.home.public}
                privateLabel={tr.home.private}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="mine" className="mt-3 space-y-2">
          {myTournaments.length === 0 ? (
            <EmptyState icon={<Trophy className="w-7 h-7" />} title={pa.emptyMine} />
          ) : (
            myTournaments.map((t) => (
              <TournamentCard
                key={t.id}
                t={t}
                fmt={fmt}
                openLabel={tr.common.open}
                adminLabel={tr.nav.admin}
                publicLabel={tr.home.public}
                privateLabel={tr.home.private}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="results" className="mt-3 space-y-3">
          <Card className="p-4 shadow-card space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4" /> {pa.syncTitle}
            </h3>
            <dl className="grid sm:grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{pa.syncReason}</dt>
                <dd className="font-mono text-xs break-all">{syncState?.last_reason ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{pa.syncPoll}</dt>
                <dd>{fmt(syncState?.last_poll_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{pa.syncDispatch}</dt>
                <dd>{fmt(syncState?.last_dispatch_at)}</dd>
              </div>
            </dl>
          </Card>

          <ManualResultsEditor enabled={!!isPlatformAdmin} locale={locale} fmt={fmt} />

          <div className="pt-1">
            <h3 className="text-sm font-semibold mb-2">{pa.liveSection}</h3>
            {liveLoad ? (
              <SkeletonList />
            ) : liveMatches.length === 0 ? (
              <EmptyState icon={<ClipboardList className="w-7 h-7" />} title={pa.emptyResults} />
            ) : (
              <div className="space-y-2">
                {liveMatches.map((m) => (
                  <Card key={m.id} className="p-3 shadow-card flex items-center gap-3 min-w-0">
                    <CompetitionBadge
                      name={m.competition?.name ?? "-"}
                      logoUrl={m.competition?.logo_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {m.home_team?.short_name || m.home_team?.name || "?"}{" "}
                        <span className="tabular text-muted-foreground">
                          {m.home_score ?? "–"}:{m.away_score ?? "–"}
                        </span>{" "}
                        {m.away_team?.short_name || m.away_team?.name || "?"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.status} · {fmt(m.kickoff_at)}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-3 space-y-2">
          {mLoad ? (
            <SkeletonList />
          ) : filteredUsers.length === 0 ? (
            <EmptyState icon={<Users className="w-7 h-7" />} title={pa.emptyUsers} />
          ) : (
            filteredUsers.map((u) => (
              <button
                key={u.user_id}
                type="button"
                onClick={() => setSelectedUserId(u.user_id)}
                className="w-full text-left"
              >
                <Card className="p-3 shadow-card flex items-center gap-3 min-w-0 hover:bg-muted/40 transition-colors">
                  <Avatar className="h-11 w-11">
                    {u.avatar_url ? <AvatarImage src={u.avatar_url} alt="" /> : null}
                    <AvatarFallback className="bg-accent text-primary font-bold">
                      {initialsOf(u.name) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.count === 1
                        ? pa.tournamentCountOne
                        : pa.tournamentCountMany.replace("{n}", String(u.count))}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Card>
              </button>
            ))
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-3 space-y-3">
          <Card className="p-4 shadow-card space-y-2">
            <h3 className="font-semibold text-sm">{pa.toolsTitle}</h3>
            <p className="text-sm text-muted-foreground">{pa.toolsDesc}</p>
            <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
              <li>{pa.toolsItemCrests}</li>
              <li>{pa.toolsItemOverrides}</li>
              <li>{pa.toolsItemSync}</li>
              <li>{pa.toolsItemAnnouncements}</li>
            </ul>
          </Card>
        </TabsContent>
      </Tabs>

      <UserMembershipsSheet
        open={!!selectedUserId}
        onOpenChange={(open) => {
          if (!open) setSelectedUserId(null);
        }}
        user={selectedUser}
        enabled={!!isPlatformAdmin && !!selectedUserId}
      />
    </AppShell>
  );
}

function ManualResultsEditor({
  enabled,
  locale,
  fmt,
}: {
  enabled: boolean;
  locale: string;
  fmt: (iso: string | null | undefined) => string;
}) {
  const { t: tr } = useT();
  const pa = tr.platformAdmin;
  const r = tr.admin.results;
  const qc = useQueryClient();

  const [competitionId, setCompetitionId] = useState("");
  const [selectedRoundKey, setSelectedRoundKey] = useState("");
  const [matchId, setMatchId] = useState("");
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [status, setStatus] = useState<"scheduled" | "live" | "finished">("scheduled");

  const { data: competitions = [], isLoading: cLoad } = useQuery({
    queryKey: ["platform-admin-competitions"],
    enabled,
    queryFn: async (): Promise<CompetitionOption[]> => {
      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, season, logo_url, is_active")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CompetitionOption[];
    },
  });

  const { data: matches = [], isLoading: mLoad } = useQuery({
    queryKey: ["platform-admin-competition-matches", competitionId],
    enabled: enabled && !!competitionId,
    queryFn: async (): Promise<EditableMatch[]> => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, kickoff_at, status, home_score, away_score, et_home_score, et_away_score, pen_home_score, pen_away_score, manual_override, round_or_matchday, phase, home_team:competition_teams!matches_home_team_id_fkey(name, short_name), away_team:competition_teams!matches_away_team_id_fkey(name, short_name)",
        )
        .eq("competition_id", competitionId)
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as EditableMatch[];
    },
  });

  const labelFn = locale === "en" ? phaseRoundLabelEn : phaseRoundLabelPt;

  const roundOptions = useMemo(() => {
    const map = new Map<string, RoundOption>();
    for (const m of matches) {
      const key = roundKey(m.round_or_matchday, m.phase);
      if (map.has(key)) continue;
      map.set(key, {
        key,
        round: m.round_or_matchday,
        phase: m.phase,
        label: labelFn(m.phase, m.round_or_matchday),
      });
    }
    return [...map.values()].sort((a, b) => {
      const ar = a.round ?? 9999;
      const br = b.round ?? 9999;
      if (ar !== br) return ar - br;
      return a.label.localeCompare(b.label);
    });
  }, [matches, labelFn]);

  const roundMatches = useMemo(() => {
    if (!selectedRoundKey) return [];
    return matches.filter(
      (m) => roundKey(m.round_or_matchday, m.phase) === selectedRoundKey,
    );
  }, [matches, selectedRoundKey]);

  const selectedMatch = useMemo(
    () => roundMatches.find((m) => m.id === matchId) ?? null,
    [roundMatches, matchId],
  );

  useEffect(() => {
    setSelectedRoundKey("");
    setMatchId("");
  }, [competitionId]);

  useEffect(() => {
    setMatchId("");
  }, [selectedRoundKey]);

  useEffect(() => {
    if (!selectedMatch) {
      setHomeScore("");
      setAwayScore("");
      setStatus("scheduled");
      return;
    }
    setHomeScore(selectedMatch.home_score == null ? "" : String(selectedMatch.home_score));
    setAwayScore(selectedMatch.away_score == null ? "" : String(selectedMatch.away_score));
    setStatus(selectedMatch.status);
  }, [selectedMatch]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMatch) throw new Error("no match");
      const home = homeScore.trim() === "" ? null : Number(homeScore);
      const away = awayScore.trim() === "" ? null : Number(awayScore);
      if (home != null && (!Number.isFinite(home) || home < 0 || !Number.isInteger(home))) {
        throw new Error("invalid home");
      }
      if (away != null && (!Number.isFinite(away) || away < 0 || !Number.isInteger(away))) {
        throw new Error("invalid away");
      }
      if (status === "finished" && (home == null || away == null)) {
        throw new Error("needBoth");
      }
      const { error } = await supabase
        .from("matches")
        .update({
          home_score: home,
          away_score: away,
          status,
          manual_override: true,
        })
        .eq("id", selectedMatch.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(r.updatedOk);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["platform-admin-competition-matches", competitionId] }),
        qc.invalidateQueries({ queryKey: ["platform-admin-live-matches"] }),
      ]);
    },
    onError: (err: Error) => {
      if (err.message === "needBoth") {
        toast.error(r.needBoth);
        return;
      }
      toast.error(err.message || tr.common.error);
    },
  });

  const selectClass =
    "w-full h-10 px-2 rounded-md border border-input bg-input text-foreground text-sm";

  return (
    <Card className="p-4 shadow-card space-y-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="w-4 h-4" /> {pa.manualEditTitle}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{r.apiOnly}</p>
        <p className="text-xs text-muted-foreground">{r.apiOnlyDesc}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pa-competition">{pa.pickCompetition}</Label>
          <select
            id="pa-competition"
            className={selectClass}
            value={competitionId}
            disabled={cLoad}
            onChange={(e) => setCompetitionId(e.target.value)}
          >
            <option value="">{pa.pickCompetitionPlaceholder}</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.season}
                {!c.is_active ? ` (${pa.inactive})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pa-round">{pa.pickRound}</Label>
          <select
            id="pa-round"
            className={selectClass}
            value={selectedRoundKey}
            disabled={!competitionId || mLoad || roundOptions.length === 0}
            onChange={(e) => setSelectedRoundKey(e.target.value)}
          >
            <option value="">{pa.pickRoundPlaceholder}</option>
            {roundOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pa-match">{pa.pickMatch}</Label>
          <select
            id="pa-match"
            className={selectClass}
            value={matchId}
            disabled={!selectedRoundKey || roundMatches.length === 0}
            onChange={(e) => setMatchId(e.target.value)}
          >
            <option value="">{pa.pickMatchPlaceholder}</option>
            {roundMatches.map((m) => {
              const home = m.home_team?.short_name || m.home_team?.name || "?";
              const away = m.away_team?.short_name || m.away_team?.name || "?";
              const score =
                m.home_score != null && m.away_score != null
                  ? `${m.home_score}:${m.away_score}`
                  : "–:–";
              return (
                <option key={m.id} value={m.id}>
                  {home} {score} {away}
                  {m.manual_override ? ` ${r.manualTag}` : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {competitionId && !mLoad && matches.length === 0 && (
        <EmptyState icon={<ClipboardList className="w-7 h-7" />} title={r.empty} description={r.emptyDesc} />
      )}

      {selectedMatch && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {selectedMatch.home_team?.name ?? "?"} vs {selectedMatch.away_team?.name ?? "?"}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmt(selectedMatch.kickoff_at)}
                {selectedMatch.manual_override ? ` ${r.manualTag}` : ""}
              </p>
            </div>
            {selectedMatch.manual_override && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold">
                {r.manualBadge}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pa-home">{selectedMatch.home_team?.short_name || selectedMatch.home_team?.name || "Home"}</Label>
              <Input
                id="pa-home"
                type="number"
                min={0}
                inputMode="numeric"
                className="h-10 tabular"
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pa-away">{selectedMatch.away_team?.short_name || selectedMatch.away_team?.name || "Away"}</Label>
              <Input
                id="pa-away"
                type="number"
                min={0}
                inputMode="numeric"
                className="h-10 tabular"
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pa-status">{r.state}</Label>
              <select
                id="pa-status"
                className={selectClass}
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "scheduled" | "live" | "finished")
                }
              >
                <option value="scheduled">{r.scheduled}</option>
                <option value="live">{r.live}</option>
                <option value="finished">{r.finished}</option>
              </select>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? tr.common.saving : r.fix}
          </Button>
        </div>
      )}
    </Card>
  );
}

function UserMembershipsSheet({
  open,
  onOpenChange,
  user,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UniqueUser | null;
  enabled: boolean;
}) {
  const { t: tr, dateLocale } = useT();
  const pa = tr.platformAdmin;

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["platform-admin-user-memberships", user?.user_id],
    enabled: enabled && !!user?.user_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_members")
        .select(
          "role, joined_at, tournament_id, tournament:tournaments(id, name, is_official, is_public)",
        )
        .eq("user_id", user!.user_id)
        .order("joined_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        role: string;
        joined_at: string;
        tournament_id: string;
        tournament: {
          id: string;
          name: string;
          is_official: boolean;
          is_public: boolean;
        } | null;
      }>;
    },
  });

  const roleLabel = (role: string) => {
    if (role === "owner") return pa.roleOwner;
    if (role === "admin") return pa.roleAdmin;
    if (role === "spectator") return pa.roleSpectator;
    return pa.rolePlayer;
  };

  const roleClass = (role: string) => {
    if (role === "owner") return "bg-primary/10 text-primary";
    if (role === "admin") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    if (role === "spectator") return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    return "bg-muted text-muted-foreground";
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{pa.userDetailTitle}</SheetTitle>
          <SheetDescription>{pa.userDetailDesc}</SheetDescription>
        </SheetHeader>

        {user && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-14 w-14">
                {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
                <AvatarFallback className="bg-accent text-primary font-bold text-lg">
                  {initialsOf(user.name) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-lg truncate">{user.name}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">{user.user_id}</p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">{pa.userTournaments}</h4>
              {isLoading ? (
                <SkeletonList />
              ) : memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">{pa.userNoTournaments}</p>
              ) : (
                <ul className="space-y-2">
                  {memberships.map((m) => (
                    <li key={`${m.tournament_id}-${m.role}`}>
                      <Card className="p-3 shadow-card space-y-2">
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {m.tournament?.name ?? m.tournament_id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(m.joined_at).toLocaleDateString(dateLocale)}
                              {m.tournament?.is_official ? ` · ${tr.tournament.official}` : ""}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold",
                              roleClass(m.role),
                            )}
                          >
                            {roleLabel(m.role)}
                          </span>
                        </div>
                        {m.tournament?.id && (
                          <Button asChild size="sm" variant="outline" className="w-full">
                            <Link to="/t/$id" params={{ id: m.tournament.id }}>
                              {tr.common.open} <ExternalLink className="w-3.5 h-3.5 ml-1" />
                            </Link>
                          </Button>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular mt-0.5">{value}</p>
    </Card>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function TournamentCard({
  t,
  fmt,
  openLabel,
  adminLabel,
  publicLabel,
  privateLabel,
}: {
  t: TournamentRow;
  fmt: (iso: string) => string;
  openLabel: string;
  adminLabel: string;
  publicLabel: string;
  privateLabel: string;
}) {
  return (
    <Card className="p-3 sm:p-4 shadow-card flex items-center gap-3 min-w-0">
      <CompetitionBadge
        name={t.competition?.name ?? t.name}
        logoUrl={t.competition?.logo_url}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="font-semibold truncate">{t.name}</p>
          {t.is_official && <OfficialBadge />}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {t.competition?.name ?? "-"} · {t.is_public ? publicLabel : privateLabel} · {t.join_code} ·{" "}
          {fmt(t.created_at)}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/t/$id" params={{ id: t.id }}>
          {openLabel} <ExternalLink className="w-3.5 h-3.5 ml-1" />
        </Link>
      </Button>
      {t.is_official && (
        <Button asChild size="sm" variant="secondary" className="shrink-0 hidden sm:inline-flex">
          <Link to="/t/$id/admin" params={{ id: t.id }}>
            {adminLabel}
          </Link>
        </Button>
      )}
    </Card>
  );
}
