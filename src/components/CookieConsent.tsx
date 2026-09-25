import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

const STORAGE_KEY = "predz_cookie_consent";

type Consent = "accepted" | "rejected" | null;

function readConsent(): Consent {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Cookie / analytics consent (Lei 41/2004 + RGPD).
 * Essential cookies (session, theme, locale) need no banner.
 * Vercel Analytics / Speed Insights load only after accept.
 */
export function CookieConsent() {
  const { t } = useT();
  const c = t.cookies;
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
  }, []);

  function choose(next: "accepted" | "rejected") {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setConsent(next);
  }

  if (!ready) return null;

  return (
    <>
      {consent === "accepted" && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
      {consent === null && (
        <div
          role="dialog"
          aria-label={c.aria}
          className="fixed bottom-20 sm:bottom-0 inset-x-0 z-[100] p-3 sm:p-4 pointer-events-none"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-3xl pointer-events-auto rounded-xl border bg-card shadow-card p-4 sm:p-5 space-y-3">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">{c.title}</p>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {c.body}{" "}
                <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  {c.privacyLink}
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col-reverse xs:flex-row gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => choose("rejected")}
              >
                {c.reject}
              </Button>
              <Button type="button" className="h-10" onClick={() => choose("accepted")}>
                {c.accept}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
