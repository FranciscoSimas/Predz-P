import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { ensureDevAccessAllowed } from "@/lib/dev-environment";
import { takePostAuthPath, goPostAuth } from "@/lib/post-auth-redirect";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = t.auth.callbackTitle;
  }, [t.auth.callbackTitle]);

  useEffect(() => {
    let active = true;
    let settled = false;

    async function goApp(userId: string) {
      if (!active || settled) return;
      const allowed = await ensureDevAccessAllowed(userId);
      if (!active || settled) return;
      if (!allowed) {
        settled = true;
        setError(t.auth.devAdminsOnly);
        return;
      }
      settled = true;
      goPostAuth((opts) => navigate({ ...opts, replace: true }));
    }

    function fail(message: string) {
      if (!active || settled) return;
      settled = true;
      const friendly =
        /pkce|code verifier/i.test(message) ? t.auth.callbackFail : message;
      setError(friendly);
    }

    // Prefer auth events - covers PKCE + hash token recovery without racing getSession.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        if (!settled) {
          settled = true;
          navigate({ to: "/auth/update-password", replace: true });
        }
        return;
      }
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        void goApp(session.user.id);
      }
    });

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError) {
          // Session may already exist if a prior tab finished the exchange.
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            void goApp(session.user.id);
            return;
          }
          fail(exchangeError.message);
          return;
        }
        if (data.session?.user) {
          void goApp(data.session.user.id);
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (session?.user) {
        void goApp(session.user.id);
        return;
      }

      const hasHashTokens = window.location.hash.includes("access_token");
      if (hasHashTokens) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!active || settled) return;
        const {
          data: { session: retry },
        } = await supabase.auth.getSession();
        if (retry?.user) {
          void goApp(retry.user.id);
          return;
        }
        fail(t.auth.callbackFail);
        return;
      }

      await new Promise((r) => setTimeout(r, 800));
      if (!active || settled) return;
      const {
        data: { session: late },
      } = await supabase.auth.getSession();
      if (late?.user) {
        void goApp(late.user.id);
        return;
      }
      fail(t.auth.sessionMissing);
    }

    void handleCallback();
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate, t.auth.callbackFail, t.auth.sessionMissing, t.auth.devAdminsOnly]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B1220] px-4 text-[#F1F5F9]">
      <p className="text-sm text-white/70">
        {error ? error : t.auth.connecting}
      </p>
      {error && (
        <div className="mt-4 space-y-2 text-center">
          <p className="text-sm font-medium text-red-400">{t.auth.connectError}</p>
          <Link to="/auth" className="text-sm text-[#22C55E] underline-offset-2 hover:underline">
            {t.auth.backToLogin}
          </Link>
        </div>
      )}
    </div>
  );
}
