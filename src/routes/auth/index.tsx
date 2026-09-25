import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";
import {
  ensureDevAccessAllowed,
  isDevHost,
} from "@/lib/dev-environment";
import { goPostAuth, peekPostAuthPath, takePostAuthPath } from "@/lib/post-auth-redirect";

type AuthSearch = { reason?: string };

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Predz - Entrar" },
      {
        name: "description",
        content: "Entra ou cria a tua conta Predz para fazer prognósticos com amigos.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;
    if (isDevHost()) {
      const allowed = await ensureDevAccessAllowed(user.id);
      if (!allowed) return;
    }
    const pending = peekPostAuthPath();
    if (pending) {
      const path = takePostAuthPath()!;
      const qIndex = path.indexOf("?");
      const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
      const search: Record<string, string> = {};
      if (qIndex >= 0) {
        new URLSearchParams(path.slice(qIndex + 1)).forEach((value, key) => {
          search[key] = value;
        });
      }
      throw redirect({
        to: pathname,
        search: Object.keys(search).length ? search : undefined,
      } as never);
    }
    throw redirect({ to: "/home" });
  },
  component: AuthPage,
});
function AuthPage() {
  const navigate = useNavigate();
  const { reason } = Route.useSearch();
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const onDev = isDevHost();

  // Auth surface is always dark Predz branding; restore user theme on leave.
  useEffect(() => {
    const prev: Theme = getStoredTheme() ?? "light";
    document.documentElement.classList.add("dark");
    return () => applyTheme(prev);
  }, []);

  useEffect(() => {
    document.title = t.auth.title;
  }, [t.auth.title]);

  useEffect(() => {
    if (reason === "dev_admins_only") {
      toast.error(t.auth.devAdminsOnly);
    }
  }, [reason, t.auth.devAdminsOnly]);

  async function enterApp(userId: string) {
    const allowed = await ensureDevAccessAllowed(userId);
    if (!allowed) {
      toast.error(t.auth.devAdminsOnly);
      return false;
    }
    return true;
  }

  async function handleGoogle() {
    if (!acceptedTerms) {
      toast.error(t.auth.acceptTermsRequired);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { toast.error(error.message); setLoading(false); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    // Ensure session is readable before entering /_authenticated beforeLoad.
    let userId = data.user?.id ?? data.session?.user?.id;
    if (!data.session || !userId) {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.user) {
        setLoading(false);
        return toast.error(t.auth.sessionMissing);
      }
      userId = sess.session.user.id;
    }
    const ok = await enterApp(userId);
    setLoading(false);
    if (!ok) return;
    goPostAuth((opts) => navigate({ ...opts, replace: true }));
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (onDev) {
      toast.error(t.auth.devAdminsOnly);
      return;
    }
    if (!acceptedTerms) {
      toast.error(t.auth.acceptTermsSignup);
      return;
    }
    if (password.length < 6) {
      toast.error(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t.auth.passwordMismatch);
      return;
    }
    setLoading(true);
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { display_name: name || email.split("@")[0] },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);

    if (data.session?.user) {
      const ok = await enterApp(data.session.user.id);
      if (!ok) return;
      toast.success(t.auth.accountCreated);
      goPostAuth((opts) => navigate({ ...opts, replace: true }));
      return;
    }

    setPendingConfirmEmail(email.trim());
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
              <span className="text-[13px] uppercase tracking-wider text-[#22C55E]">
                {t.brand.tagline}
              </span>
            </Link>
          </div>

          {onDev && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-center text-[12px] leading-snug text-amber-100">
              {t.auth.devBanner}
            </div>
          )}

          <div className="rounded-2xl border border-white/15 bg-[#0F172A]/85 p-5 shadow-2xl shadow-black/40 backdrop-blur-md">
            {pendingConfirmEmail ? (
              <div className="space-y-4 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#22C55E]">
                  Predz
                </p>
                <h1 className="text-xl font-semibold text-white">{t.auth.checkEmailTitle}</h1>
                <p className="text-[13px] leading-relaxed text-white/70">
                  {t.auth.checkEmailBody.replace("{email}", pendingConfirmEmail)}
                </p>
                <p className="text-[12px] text-white/45">{t.auth.checkEmailResendHint}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setPendingConfirmEmail(null)}
                >
                  {t.auth.backToLogin}
                </Button>
              </div>
            ) : (
              <>
            <label className="mb-4 flex items-start gap-2 text-[11px] leading-snug text-white/60">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/30 bg-white/5"
              />
              <span>
                {t.auth.acceptAgeTerms}{" "}
                <Link to="/terms" className="text-[#22C55E] underline-offset-2 hover:underline">
                  {t.landing.terms}
                </Link>
                {" · "}
                <Link to="/privacy" className="text-[#22C55E] underline-offset-2 hover:underline">
                  {t.landing.privacy}
                </Link>
              </span>
            </label>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={handleGoogle}
              disabled={loading || !acceptedTerms}
            >
              <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {t.auth.continueGoogle}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/15" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#0F172A] px-2 text-white/50">{t.common.or}</span>
              </div>
            </div>

            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-white/5">
                <TabsTrigger
                  value="login"
                  className="data-[state=active]:bg-[#22C55E] data-[state=active]:text-[#0F172A]"
                >
                  {t.auth.signIn}
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  className="data-[state=active]:bg-[#22C55E] data-[state=active]:text-[#0F172A]"
                >
                  {t.auth.signUp}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="login" className="pt-4">
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <Label htmlFor="li-email" className="text-white/80">{t.common.email}</Label>
                    <Input
                      id="li-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="li-pw" className="text-white/80">{t.common.password}</Label>
                      <Link
                        to="/auth/forgot-password"
                        className="text-[11px] text-[#22C55E] underline-offset-2 hover:underline"
                      >
                        {t.auth.forgotPassword}
                      </Link>
                    </div>
                    <Input
                      id="li-pw"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-11 w-full bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A]"
                    disabled={loading}
                  >
                    {t.auth.signIn}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup" className="pt-4">
                <form onSubmit={handleSignup} className="space-y-3">
                  <div>
                    <Label htmlFor="su-name" className="text-white/80">{t.common.name}</Label>
                    <Input
                      id="su-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <div>
                    <Label htmlFor="su-email" className="text-white/80">{t.common.email}</Label>
                    <Input
                      id="su-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <div>
                    <Label htmlFor="su-pw" className="text-white/80">{t.common.password}</Label>
                    <Input
                      id="su-pw"
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
                    <Label htmlFor="su-pw2" className="text-white/80">{t.auth.confirmPassword}</Label>
                    <Input
                      id="su-pw2"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-11 w-full bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A]"
                    disabled={loading || !acceptedTerms}
                  >
                    {t.auth.createAccount}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-white/45">
            <Link to="/" className="underline-offset-4 hover:text-white hover:underline">
              {t.auth.backHome}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
