import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Binoculars,
  Plus,
  Users,
  Trophy,
  ChevronRight,
  Globe2,
  Lock,
  Compass,
} from "lucide-react";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { OfficialBadge } from "@/components/OfficialBadge";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const { t: tr } = useT();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  type MyTournament = {
    role: string;
    tournament: {
      id: string;
      name: string;
      description: string | null;
      cover_color: string | null;
      join_code: string;
      is_public: boolean;
      is_official: boolean;
      competition: { name: string; season: string; logo_url: string | null } | null;
    } | null;
  };

  const {
    data: tournaments,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["my-tournaments"],
    queryFn: async (): Promise<MyTournament[]> => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("tournament_members")
        .select(
          "role, tournament:tournaments(id, name, description, cover_color, join_code, is_public, is_official, competition:competitions(name, season, logo_url))",
        )
        .eq("user_id", uid);
      if (error) throw error;
      return (data ?? []) as unknown as MyTournament[];
    },
  });

  const displayName =
    (me?.user_metadata?.display_name as string | undefined) ??
    (me?.user_metadata?.full_name as string | undefined) ??
    me?.email?.split("@")[0] ??
    "";

  return (
    <AppShell>
      <section className="rounded-2xl overflow-hidden gradient-hero p-5 sm:p-8 shadow-card">
        <p className="text-xs uppercase tracking-widest opacity-80 truncate">
          {tr.home.hello} {displayName || tr.home.player} 👋
        </p>
        <h1 className="text-2xl sm:text-3xl font-display tracking-wide mt-1">{tr.home.myTournaments}</h1>
        <p className="text-sm opacity-90 mt-1 max-w-md">{tr.home.heroDesc}</p>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-5 sm:max-w-2xl">
          <Button asChild variant="secondary" className="flex-1 min-w-[10rem] h-11">
            <Link to="/create">
              <Plus className="w-4 h-4 mr-1.5" /> {tr.home.createTournament}
            </Link>
          </Button>
          <Button
            asChild
            className="flex-1 min-w-[10rem] h-11 bg-white/15 text-white hover:bg-white/25 border border-white/25"
          >
            <Link to="/join">
              <Users className="w-4 h-4 mr-1.5" /> {tr.home.joinWithCode}
            </Link>
          </Button>
          <Button
            asChild
            className="flex-1 min-w-[10rem] h-11 bg-white/15 text-white hover:bg-white/25 border border-white/25"
          >
            <Link to="/explore">
              <Compass className="w-4 h-4 mr-1.5" /> {tr.home.joinPublic}
            </Link>
          </Button>
        </div>
      </section>

      <div className="mt-6 sm:mt-8">
        <div className="flex items-center justify-between mb-3 gap-2 min-w-0">
          <h2 className="text-lg font-bold truncate">{tr.home.active}</h2>
          <span className="text-xs text-muted-foreground tabular shrink-0">{tournaments?.length ?? 0}</span>
        </div>

        {isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <Card className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? tr.home.loadError}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {tr.common.retry}
            </Button>
          </Card>
        ) : !tournaments || tournaments.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-7 h-7" />}
            title={tr.home.emptyTitle}
            description={tr.home.emptyDesc}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link to="/create">{tr.home.create}</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/join">{tr.home.join}</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/explore">{tr.home.joinPublic}</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tournaments.map((tm) => {
              const t = tm.tournament;
              if (!t) return null;
              return (
                <Link key={t.id} to="/t/$id" params={{ id: t.id }} className="group min-w-0">
                  <Card className="p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3 shadow-card group-hover:border-primary/50 group-hover:shadow-md transition-all min-w-0 overflow-hidden">
                    <CompetitionBadge
                      name={t.competition?.name ?? t.name}
                      logoUrl={t.competition?.logo_url}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-semibold truncate min-w-0 flex-1">{t.name}</p>
                        {tm.role === "spectator" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                            <Binoculars className="h-2.5 w-2.5" /> {tr.join.roleSpectator}
                          </span>
                        ) : t.is_official ? (
                          <OfficialBadge />
                        ) : t.is_public ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground inline-flex items-center gap-1">
                            <Globe2 className="w-2.5 h-2.5" /> {tr.home.public}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> {tr.home.private}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {t.competition?.name} · {tr.home.seasonPrefix} {t.competition?.season}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 hidden xs:block sm:block" />
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
