import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AppBrand } from "@/components/AppBrand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/lib/i18n";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  const { t } = useT();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/85 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <AppBrand />
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher variant="ghost" showLabel />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              {t.legal.home}
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-display tracking-wide">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.legal.updatedPrefix} {updated}
        </p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-8 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
        <p className="mt-10 pt-6 border-t text-xs text-muted-foreground">
          {t.legal.contact}{" "}
          <a href="mailto:suporte@predz.app">suporte@predz.app</a>
          {" · "}
          <Link to="/terms">{t.legal.termsLink}</Link>
          {" · "}
          <Link to="/privacy">{t.legal.privacyLink}</Link>
        </p>
      </main>
    </div>
  );
}
