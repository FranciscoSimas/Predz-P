import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => ({
    meta: [
      { title: "Predz - Recuperar password" },
      {
        name: "description",
        content: "Pede um link para redefinir a password da tua conta Predz.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const prev: Theme = getStoredTheme() ?? "light";
    document.documentElement.classList.add("dark");
    return () => applyTheme(prev);
  }, []);

  useEffect(() => {
    document.title = `Predz - ${t.auth.forgotTitle}`;
  }, [t.auth.forgotTitle]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success(t.auth.forgotSent);
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
            <h1 className="text-lg font-semibold text-white">{t.auth.forgotTitle}</h1>
            <p className="mt-1 text-[13px] leading-snug text-white/60">{t.auth.forgotDescription}</p>

            {sent ? (
              <p className="mt-4 text-sm text-[#22C55E]">{t.auth.forgotSent}</p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="fp-email" className="text-white/80">
                    {t.common.email}
                  </Label>
                  <Input
                    id="fp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="mt-1 h-11 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                  />
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A]"
                  disabled={loading}
                >
                  {t.auth.forgotSend}
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
