import { createFileRoute, Outlet, Link, useLocation, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  ListChecks,
  Trophy,
  Copy,
  CalendarDays,
  Table2,
  Settings as SettingsIcon,
  Info,
  Globe2,
  Lock,
  Binoculars,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AppBrand } from "@/components/AppBrand";
import { UserMenu } from "@/components/UserMenu";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { OfficialBadge } from "@/components/OfficialBadge";
import { useT } from "@/lib/i18n";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_authenticated/t/$id")({
  component: TournamentLayout,
});

function TournamentLayout() {
  const { id } = useParams({ from: "/_authenticated/t/$id" });
  const loc = useLocation();

  const { data: tournament } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id, name, join_code, cover_color, is_public, is_official, competition:competitions(name, season, format, logo_url)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: isPlatformAdmin } = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user?.id;
      if (!uid) return false;
      const { data } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();
      return !!data;
    },
  });

  const { data: myRole } = useQuery({
    queryKey: ["my-role", id],
    queryFn: async () => {
      const { data: uRes } = await supabase.auth.getUser();
      const uid = uRes.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("tournament_members")
        .select("role")
        .eq("tournament_id", id)
        .eq("user_id", uid)
        .maybeSingle();
      return data?.role ?? null;
    },
  });
  const isOfficial = !!tournament?.is_official;
  const canAdminister = isOfficial ? !!isPlatformAdmin : myRole === "owner" || myRole === "admin";
  const isAdmin = canAdminister;

  const { t: tr, formatLabel } = useT();
  const base = `/t/${id}`;
  const isLeagueFormat =
    tournament?.competition?.format === "league" ||
    tournament?.competition?.format === "league_phase_then_knockout";
  const tabs = [
    {
      to: base,
      label: tr.nav.home,
      icon: LayoutDashboard,
      match: (p: string) => p === base || p === `${base}/`,
    },
    {
      to: `${base}/matches`,
      label: tr.nav.matches,
      icon: CalendarDays,
      match: (p: string) => p === `${base}/matches`,
    },
    isLeagueFormat
      ? {
          to: `${base}/standings`,
          label: tr.nav.standings,
          icon: Table2,
          match: (p: string) => p === `${base}/standings`,
        }
      : null,
    myRole !== "spectator"
      ? {
          to: `${base}/predictions`,
          label: tr.nav.predictions,
          icon: ListChecks,
          match: (p: string) => p === `${base}/predictions`,
        }
      : null,
    {
      to: `${base}/ranking`,
      label: tr.nav.ranking,
      icon: Trophy,
      match: (p: string) => p === `${base}/ranking`,
    },
    isAdmin
      ? {
          to: `${base}/admin`,
          label: tr.nav.admin,
          icon: SettingsIcon,
          match: (p: string) => p === `${base}/admin` || p.startsWith(`${base}/admin/`),
        }
      : {
          to: `${base}/info`,
          label: tr.nav.info,
          icon: Info,
          match: (p: string) => p === `${base}/info` || p.startsWith(`${base}/info/`),
        },
  ].filter(Boolean) as Array<{
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    match: (p: string) => boolean;
  }>;

  function copyCode() {
    if (!tournament?.join_code) return;
    navigator.clipboard.writeText(tournament.join_code);
    toast.success(tr.tournament.codeCopied);
  }

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-1.5 sm:gap-3 px-2.5 sm:px-6 h-14 sm:h-16 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
            <AppBrand to="/home" size="sm" />
            {tournament?.competition && (
              <CompetitionBadge
                name={tournament.competition.name}
                logoUrl={tournament.competition.logo_url}
                size="md"
                className="hidden sm:inline-flex shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-1 min-w-0">
                <p className="font-semibold truncate min-w-0 text-sm sm:text-base leading-tight">
                  {tournament?.name ?? "…"}
                </p>
                {tournament?.is_official && (
                  <span className="hidden sm:inline-flex shrink-0">
                    <OfficialBadge />
                  </span>
                )}
                {myRole === "spectator" && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300 shrink-0">
                    <Binoculars className="h-2.5 w-2.5" />
                    {tr.join.roleSpectator}
                  </span>
                )}
                {tournament &&
                  !tournament.is_official &&
                  (tournament.is_public ? (
                    <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground items-center gap-1 shrink-0">
                      <Globe2 className="w-2.5 h-2.5" /> {tr.tournament.public}
                    </span>
                  ) : (
                    <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground items-center gap-1 shrink-0">
                      <Lock className="w-2.5 h-2.5" /> {tr.tournament.private}
                    </span>
                  ))}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate leading-tight">
                {tournament?.competition?.name}
                {tournament?.competition?.season
                  ? ` · ${tr.tournament.seasonPrefix} ${tournament.competition.season}`
                  : ""}
                {tournament?.competition?.format
                  ? ` · ${formatLabel(tournament.competition.format)}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
            {tournament?.join_code && !isOfficial && (
              <Button
                variant="outline"
                size="sm"
                onClick={copyCode}
                className="font-mono tabular hidden sm:inline-flex shrink-0 h-9"
                aria-label={tr.tournament.copyCode}
              >
                {tournament.join_code} <Copy className="w-3 h-3 ml-1" />
              </Button>
            )}
            <UserMenu />
          </div>
        </div>

        {/* Desktop tabs */}
        <div className="hidden sm:block border-t bg-background/60">
          <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const active = t.match(loc.pathname);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  {...(t.to.startsWith("/t/") ? { params: { id } } : {})}
                  className={`inline-flex items-center gap-1.5 px-3 h-11 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="w-4 h-4" /> {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full min-w-0 mx-auto px-4 sm:px-6 py-4 sm:py-8 overflow-x-hidden">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className={`max-w-3xl mx-auto grid h-16 ${
            tabs.length >= 6
              ? "grid-cols-6"
              : tabs.length === 5
                ? "grid-cols-5"
                : "grid-cols-4"
          }`}
        >
          {tabs.map((t) => {
            const active = t.match(loc.pathname);
            return (
              <MobileTab
                key={t.to}
                to={t.to}
                params={t.to.startsWith("/t/") ? { id } : undefined}
                active={active}
                icon={<t.icon className="w-5 h-5" />}
                label={t.label}
                iconOnly={tabs.length >= 5}
                shortLabel={
                  t.to.endsWith("/predictions")
                    ? tr.nav.predictionsShort ?? t.label
                    : t.to.endsWith("/standings")
                      ? tr.nav.standingsShort ?? t.label
                      : t.to.endsWith("/admin")
                        ? tr.nav.admin
                        : t.to.endsWith("/info")
                          ? tr.nav.infoShort ?? tr.nav.info
                          : t.label
                }
              />
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function MobileTab({
  to,
  params,
  active,
  icon,
  label,
  shortLabel,
  iconOnly,
}: {
  to: string;
  params?: Record<string, string>;
  active: boolean;
  icon: ReactNode;
  label: string;
  shortLabel?: string;
  iconOnly?: boolean;
}) {
  return (
    <Link
      to={to}
      {...(params ? { params } : {})}
      aria-label={label}
      className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors min-h-[44px] min-w-0 ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      {icon}
      {iconOnly ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate max-w-full px-0.5">{shortLabel ?? label}</span>
      )}
    </Link>
  );
}
