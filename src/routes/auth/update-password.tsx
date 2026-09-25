import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

export const Route = createFileRoute("/auth/update-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Predz - Nova password" },
      {
        name: "description",
        content: "Define uma nova password para a tua conta Predz.",
      },
    ],
  }),
  component: UpdatePasswordPage,
});

function UpdatePasswordPage() {
  const navigate = useNavigate();
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const prev: Theme = getStoredTheme() ?? "light";
    document.documentElement.classList.add("dark");
    return () => applyTheme(prev);
  }, []);

  useEffect(() => {
    document.title = `Predz - ${t.auth.updatePasswordTitle}`;
  }, [t.auth.updatePasswordTitle]);

  useEffect(() => {
    let active = true;
    let settled = false;

    function markReady() {
      if (!active || settled) return;
      settled = true;
      setReady(true);
    }

    function markFail() {
      if (!active || settled) return;
      settled = true;
      setSessionError(true);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (
        (event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION") &&
        session
      ) {
        markReady();
      }
    });

    async function bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (error) {
          markFail();
          return;
        }
        if (data.session) {
          markReady();
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (session) {
        markReady();
        return;
      }

      const hash = window.location.hash;
      if (hash.includes("access_token") || hash.includes("type=recovery")) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!active || settled) return;
        const {
          data: { session: retry },
        } = await supabase.auth.getSession();
        if (retry) {
          markReady();
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 800));
      if (!active || settled) return;
      const {
        data: { session: late },
      } = await supabase.auth.getSession();
      if (late) {
        markReady();
        return;
      }
      markFail();
    }

    void bootstrap();
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      toast.error(t.auth.passwordMismatch);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.auth.updatePasswordSuccess);
    navigate({ to: "/home", replace: true });
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0B1220] text-[#F1F5F9]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src="/brand/hero-stadium.jpg"
          alt=""
          className="h-full w-full scale-105 object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-[#0B1220]/75" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.12),_transparent_55%)]" />
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <Link to="/" className="flex flex-col items-center gap-2">
              <img
                src="/brand/symbol-dark.png?v=4"
                alt="Predz"
                className="h-14 w-14 object-contain"
                width={56}
                height={56}
              />
              <span className="brand-wordmark text-4xl tracking-[0.04em]">
                <span className="text-white">PRED</span>
                <span className="text-[#22C55E]">Z</span>
              </span>
            </Link>
          </div>

          <div className="rounded-2xl border border-white/15 bg-[#0F172A]/85 p-5 shadow-2xl shadow-black/40 backdrop-blur-md">
            <h1 className="text-lg font-semibold text-white">{t.auth.updatePasswordTitle}</h1>
            <p className="mt-1 text-[13px] leading-snug text-white/60">
              {t.auth.updatePasswordDescription}
            </p>

            {!ready && !sessionError && (
              <p className="mt-4 text-sm text-white/60">{t.auth.connecting}</p>
            )}

            {sessionError && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-red-400">{t.auth.updatePasswordNeedSession}</p>
                <Link
                  to="/auth/forgot-password"
                  className="block text-center text-sm text-[#22C55E] underline-offset-2 hover:underline"
                >
                  {t.auth.forgotPassword}
                </Link>
              </div>
            )}

            {ready && (
              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="np-pw" className="text-white/80">
                    {t.common.password}
                  </Label>
                  <Input
                    id="np-pw"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                  />
                  <p className="mt-1 text-[11px] text-white/45">{t.auth.passwordHint}</p>
                </div>
                <div>
                  <Label htmlFor="np-confirm" className="text-white/80">
                    {t.auth.confirmPassword}
                  </Label>
                  <Input
                    id="np-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                  />
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A]"
                  disabled={loading}
                >
                  {t.auth.updatePasswordSubmit}
                </Button>
              </form>
            )}

            <p className="mt-4 text-center text-xs text-white/50">
              <Link to="/auth" className="text-[#22C55E] underline-offset-2 hover:underline">
                {t.auth.backToLogin}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
