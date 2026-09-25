import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Compass, Users, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { AppBrand } from "@/components/AppBrand";
import { UserMenu } from "@/components/UserMenu";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export function AppShell({ children }: { children: ReactNode; title?: string }) {
  const loc = useLocation();
  const { t } = useT();
  const isActive = (p: string) =>
    p === "/home"
      ? loc.pathname === "/home"
      : loc.pathname === p || loc.pathname.startsWith(`${p}/`);

  const { data: isPlatformAdmin } = useQuery({
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
    staleTime: 60_000,
  });

  const nav = [
    { to: "/home" as const, label: t.nav.tournaments, icon: Home },
    { to: "/explore" as const, label: t.nav.explore, icon: Compass },
    { to: "/join" as const, label: t.nav.join, icon: Users },
    ...(isPlatformAdmin
      ? [{ to: "/admin" as const, label: t.nav.admin, icon: Shield }]
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 sm:gap-4 px-4 sm:px-6 h-14 sm:h-16 min-w-0">
          <AppBrand to="/home" size="md" />
          <nav className="hidden sm:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 h-10 inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive(n.to)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <n.icon className="w-4 h-4" /> {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1 shrink-0">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full min-w-0 mx-auto px-4 sm:px-6 py-4 sm:py-8 overflow-x-hidden">
        {children}
      </main>

      <footer className="hidden sm:block border-t mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-3 space-y-1.5 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{t.landing.footerAbout}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 shrink-0">
              <a href="mailto:suporte@predz.app" className="hover:text-foreground">
                {t.landing.contact}: suporte@predz.app
              </a>
              <Link to="/terms" className="hover:text-foreground">
                {t.landing.terms}
              </Link>
              <Link to="/privacy" className="hover:text-foreground">
                {t.landing.privacy}
              </Link>
            </div>
          </div>
          <p className="max-w-3xl leading-relaxed">{t.landing.footerData}</p>
        </div>
      </footer>

      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className={`max-w-3xl mx-auto grid h-16 ${
            isPlatformAdmin ? "grid-cols-4" : "grid-cols-3"
          }`}
        >
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive(n.to) ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <n.icon className="w-5 h-5" />
              <span>{n.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
