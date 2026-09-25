import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { CookieConsent } from "@/components/CookieConsent";
import { DevEnvironmentBadge } from "@/components/DevEnvironmentBadge";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { themeBootstrapScript } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que procuras não existe.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo correu mal</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "PredZ" },
      {
        name: "description",
        content:
          "Football score prediction tournaments with friends. Pick real match results, climb live rankings. Private pools or public PredZ tournaments. Free, no money on the platform.",
      },
      { property: "og:title", content: "PredZ" },
      {
        property: "og:description",
        content:
          "Football score prediction tournaments with friends. Pick real match results, climb live rankings. Private pools or public PredZ tournaments.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "PredZ" },
      { property: "og:url", content: "https://predz.app/" },
      { property: "og:image", content: "https://predz.app/brand/og-1200x630.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://predz.app/brand/og-1200x630.png" },
      { name: "theme-color", content: "#22C55E" },
      { name: "application-name", content: "PredZ" },
      { name: "apple-mobile-web-app-title", content: "PredZ" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Google Search favicon: square, ≥48px preferred (app-icon-192)
      { rel: "icon", href: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", href: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
      { rel: "icon", href: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png", sizes: "180x180" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;500;600;700&display=swap",
      },
    ],
    scripts: [{ children: themeBootstrapScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <DevEnvironmentBadge />
        <Outlet />
        <Toaster richColors position="top-center" />
        <CookieConsent />
      </I18nProvider>
    </QueryClientProvider>
  );
}
