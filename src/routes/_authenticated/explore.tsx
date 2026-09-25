import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Compass, Globe2, AlertCircle, Users, ShieldCheck } from "lucide-react";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { OfficialBadge } from "@/components/OfficialBadge";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import {
  JoinTournamentDialog,
  type JoinMode,
} from "@/components/JoinTournamentDialog";

export const Route = createFileRoute("/_authenticated/explore")({
  component: ExplorePage,
});

type PublicTournament = {
  id: string;
  name: string;
  description: string | null;
  cover_color: string | null;
  is_official: boolean;
  competition: { name: string; season: string; logo_url: string | null } | null;
  tournament_members: { role: "owner" | "admin" | "member" | "spectator" }[];
};

function ExplorePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joiningMode, setJoiningMode] = useState<JoinMode | null>(null);
  const [selected, setSelected] = useState<PublicTournament | null>(null);

  const publicTournamentsQuery = useQuery({
    queryKey: ["public-tournaments"],
    queryFn: async (): Promise<PublicTournament[]> => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id, name, description, cover_color, is_official, competition:competitions(name, season, logo_url), tournament_members(role)",
        )
        .eq("is_public", true)
        .order("is_official", { ascending: false })
        .order("name", { ascending: true })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as PublicTournament[];
    },
  });

  const meQuery = useQuery({
    queryKey: ["me-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const membershipsQuery = useQuery({
    queryKey: ["my-membership-ids", meQuery.data],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_members")
        .select("tournament_id")
        .eq("user_id", meQuery.data!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.tournament_id));
    },
  });

  async function handleJoin(tournamentId: string, mode: JoinMode) {
    if (!meQuery.data) return;
    setJoiningId(tournamentId);
    setJoiningMode(mode);
    const { error } = await supabase.rpc("join_public_tournament_as", {
      _tournament_id: tournamentId,
      _as_spectator: mode === "spectator",
    });
    setJoiningId(null);
    setJoiningMode(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.explore.joined);
    queryClient.invalidateQueries({ queryKey: ["my-membership-ids"] });
    queryClient.invalidateQueries({ queryKey: ["my-tournaments"] });
    queryClient.invalidateQueries({ queryKey: ["public-tournaments"] });
    setSelected(null);
    navigate({ to: "/t/$id", params: { id: tournamentId } });
  }

  const { data: publicTournaments, isLoading, isError, error, refetch } = publicTournamentsQuery;
  const memberships = membershipsQuery.data;

  const official = (publicTournaments ?? []).filter((tt) => tt.is_official);
  const community = (publicTournaments ?? []).filter((tt) => !tt.is_official);

  function renderCard(tt: PublicTournament) {
    const isMember = memberships?.has(tt.id) ?? false;
    const isJoining = joiningId === tt.id;
    const memberCount =
      tt.tournament_members?.filter((member) => member.role !== "spectator").length ?? 0;
    return (
      <Card
        key={tt.id}
        className={`p-3 sm:p-4 flex flex-col gap-3 shadow-card min-w-0 overflow-hidden sm:flex-row sm:items-center ${tt.is_official ? "border-primary/40" : ""}`}
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
          <CompetitionBadge
            name={tt.competition?.name ?? tt.name}
            logoUrl={tt.competition?.logo_url}
            size="lg"
          />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-semibold truncate min-w-0 flex-1">{tt.name}</p>
              {tt.is_official && <OfficialBadge />}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {tt.competition?.name} · {t.home.seasonPrefix} {tt.competition?.season}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
              <Users className="w-3 h-3 shrink-0" />
              {memberCount} {memberCount === 1 ? t.explore.memberOne : t.explore.memberMany}
            </p>
          </div>
        </div>
        {isMember ? (
          <Button asChild size="sm" variant="outline" className="w-full sm:w-auto shrink-0">
            <Link to="/t/$id" params={{ id: tt.id }}>
              {t.explore.open}
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full sm:w-auto shrink-0"
            onClick={() => setSelected(tt)}
            disabled={isJoining || !meQuery.data}
          >
            {isJoining ? t.explore.joining : t.explore.join}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-primary font-semibold inline-flex items-center gap-1">
            <Compass className="w-3.5 h-3.5" /> {t.explore.badge}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display tracking-wide mt-1">{t.explore.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.explore.subtitle}</p>
        </div>

        {isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <Card className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? t.explore.loadError}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t.common.retry}
            </Button>
          </Card>
        ) : official.length === 0 && community.length === 0 ? (
          <EmptyState
            icon={<Globe2 className="w-7 h-7" />}
            title={t.explore.emptyTitle}
            description={t.explore.emptyDesc}
            action={
              <Button asChild size="sm">
                <Link to="/create">{t.explore.createPublic}</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-8">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h2 className="text-lg font-bold">{t.explore.official}</h2>
                <span className="text-xs text-muted-foreground tabular">{official.length}</span>
              </div>
              {official.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground mb-3">{t.explore.officialDesc}</p>
                  <div className="grid gap-2 sm:grid-cols-2">{official.map(renderCard)}</div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t.explore.officialDesc}</p>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <Globe2 className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-lg font-bold">{t.explore.community}</h2>
                <span className="text-xs text-muted-foreground tabular">{community.length}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{t.explore.communityDesc}</p>
              {community.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">{community.map(renderCard)}</div>
              ) : (
                <p className="text-sm text-muted-foreground">{t.explore.communityEmpty}</p>
              )}
            </section>
          </div>
        )}
      </div>
      <JoinTournamentDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !joiningMode) setSelected(null);
        }}
        preview={
          selected
            ? {
                name: selected.name,
                description: selected.description,
                competitionName: selected.competition?.name ?? selected.name,
                competitionLogoUrl: selected.competition?.logo_url,
                memberCount:
                  selected.tournament_members?.filter((member) => member.role !== "spectator")
                    .length ?? 0,
                isOfficial: selected.is_official,
                isPublic: true,
              }
            : null
        }
        joiningMode={joiningMode}
        onJoin={(mode) => selected && handleJoin(selected.id, mode)}
      />
    </AppShell>
  );
}
