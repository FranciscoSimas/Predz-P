import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Users, Building2, Globe2, Sparkles, Flame, Smartphone } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/lib/i18n";

/** Cache-bust so browsers drop the old opaque white-plate logo. */
const SYMBOL_DARK = "/brand/symbol-dark.png?v=4";
const HERO_BG = "/brand/hero-stadium.jpg";

const COMPETITIONS = [
  {
    name: "Liga Portugal",
    logo: "https://media.api-sports.io/football/leagues/94.png",
  },
  {
    name: "Premier League",
    logo: "https://media.api-sports.io/football/leagues/39.png",
  },
  {
    name: "La Liga",
    logo: "https://media.api-sports.io/football/leagues/140.png",
  },
  {
    name: "Serie A",
    logo: "https://media.api-sports.io/football/leagues/135.png",
  },
  {
    name: "Bundesliga",
    logo: "https://media.api-sports.io/football/leagues/78.png",
  },
  {
    name: "Ligue 1",
    logo: "https://media.api-sports.io/football/leagues/61.png",
  },
  {
    name: "Eredivisie",
    logo: "https://media.api-sports.io/football/leagues/88.png",
  },
  {
    name: "Championship",
    logo: "https://media.api-sports.io/football/leagues/40.png",
  },
  {
    name: "Brasileirão",
    logo: "https://media.api-sports.io/football/leagues/71.png",
  },
  {
    name: "Champions League",
    logo: "https://media.api-sports.io/football/leagues/2.png",
  },
  {
    name: "Europa League",
    logo: "https://media.api-sports.io/football/leagues/3.png",
  },
] as const;

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`landing-reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  const { t } = useT();
  const L = t.landing;

  // Landing is a fixed dark brand surface — ignore app light/dark theme.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  return (
    <div className="landing-root relative min-h-screen text-[#F1F5F9] antialiased">
      {/* Fixed stadium — same approach as /auth (blur + soft opacity) */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <img
          src={HERO_BG}
          alt=""
          className="h-full w-full scale-110 object-cover opacity-45 blur-[2px]"
        />
        <div className="absolute inset-0 bg-[#070B14]/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.12),_transparent_55%)]" />
      </div>

      <div className="relative z-10 overflow-x-hidden">
      <header className="landing-header sticky top-0 z-40 border-b border-white/[0.08] bg-[#070B14]/55 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6">
          <a href="#topo" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <img
              src={SYMBOL_DARK}
              alt=""
              className="h-8 w-8 shrink-0 object-contain"
              width={32}
              height={32}
            />
            <span className="landing-display text-[1.35rem] tracking-[0.04em] text-white">
              PRED<span className="text-[#22C55E]">Z</span>
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* Mobile: icon-only — PT label + Entrar crowded the brand */}
            <LanguageSwitcher light variant="outline" showLabel className="max-sm:px-2" />
            <Link
              to="/auth"
              className="hidden sm:inline-flex h-9 items-center px-3.5 text-sm font-medium text-white/75 transition-colors hover:text-white"
            >
              {L.signIn}
            </Link>
            <Link
              to="/auth"
              className="landing-btn-primary inline-flex h-9 items-center rounded-full bg-[#22C55E] px-3.5 sm:px-4 text-sm font-semibold text-[#070B14]"
            >
              {L.signUp}
            </Link>
          </div>
        </div>
      </header>

      <main id="topo">
        {/* Hero — brand first, one CTA group */}
        <section className="landing-hero relative flex min-h-[min(92svh,54rem)] flex-col justify-end pb-16 pt-20 sm:justify-center sm:pb-24 sm:pt-16">
          <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="landing-fade-up max-w-3xl">
              <p className="landing-kicker mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#22C55E]">
                <span className="landing-kicker-dot" aria-hidden />
                {L.kicker}
              </p>

              <h1 className="landing-display text-[clamp(3.75rem,14vw,8.5rem)] leading-[0.85] tracking-[0.02em] text-white">
                PRED<span className="text-[#22C55E]">Z</span>
              </h1>

              <p className="landing-display mt-3 text-xl tracking-[0.18em] text-[#22C55E] sm:text-2xl sm:tracking-[0.22em]">
                {L.slogan}
              </p>

              <p className="landing-body mt-6 max-w-md text-[1.05rem] leading-relaxed text-white/70 sm:text-lg">
                {L.heroBody}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/auth"
                  className="landing-btn-primary inline-flex h-12 items-center rounded-full bg-[#22C55E] px-7 text-base font-semibold text-[#070B14]"
                >
                  {L.ctaStart}
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex h-12 items-center rounded-full border border-white/20 bg-white/[0.04] px-6 text-base font-medium text-white/90 backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-white/[0.08]"
                >
                  {L.ctaHow}
                </a>
              </div>
            </div>
          </div>

          <div className="landing-hero-scroll pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 sm:block" aria-hidden>
            <span className="landing-scroll-line" />
          </div>
        </section>

        {/* How it works — timeline, not equal cards */}
        <section id="como-funciona" className="relative py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <p className="landing-kicker text-[11px] font-semibold uppercase tracking-[0.28em] text-[#22C55E]">
                {L.howKicker}
              </p>
              <h2 className="landing-display mt-3 text-4xl tracking-wide text-white sm:text-5xl">
                {L.howTitle}
              </h2>
              <p className="landing-body mt-3 max-w-lg text-white/55">
                {L.howIntro}
              </p>
            </Reveal>

            <div className="relative mt-14 sm:mt-16">
              <div
                className="pointer-events-none absolute left-[1.15rem] top-3 bottom-3 w-px bg-gradient-to-b from-[#22C55E] via-white/20 to-transparent sm:left-0 sm:right-0 sm:top-[2.75rem] sm:bottom-auto sm:h-px sm:w-full sm:bg-gradient-to-r"
                aria-hidden
              />
              <ol className="grid gap-10 sm:grid-cols-3 sm:gap-8">
                {[
                  {
                    n: "01",
                    title: L.step1Title,
                    body: L.step1Body,
                  },
                  {
                    n: "02",
                    title: L.step2Title,
                    body: L.step2Body,
                  },
                  {
                    n: "03",
                    title: L.step3Title,
                    body: L.step3Body,
                  },
                ].map((step, i) => (
                  <Reveal key={step.n} delay={i * 90}>
                    <li className="relative pl-12 sm:pl-0">
                      <span className="landing-step-num absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-[#22C55E]/50 bg-[#070B14] text-xs font-bold text-[#22C55E] sm:relative sm:mb-5 sm:h-11 sm:w-11 sm:text-sm">
                        {step.n}
                      </span>
                      <h3 className="landing-display text-2xl tracking-wide text-white sm:text-3xl">
                        {step.title}
                      </h3>
                      <p className="landing-body mt-2 text-sm leading-relaxed text-white/50 sm:text-[0.95rem]">
                        {step.body}
                      </p>
                    </li>
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Audience — horizontal strips */}
        <section className="relative border-y border-white/[0.07] bg-[#070B14]/65 py-20 backdrop-blur-md sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="landing-display text-4xl tracking-wide text-white sm:text-5xl">
                {L.audienceTitle}
              </h2>
              <p className="landing-body mt-3 max-w-xl text-white/55">
                {L.audienceIntro}
              </p>
            </Reveal>

            <div className="mt-12 space-y-3">
              {[
                {
                  icon: Users,
                  title: L.friendsTitle,
                  body: L.friendsBody,
                },
                {
                  icon: Building2,
                  title: L.colleaguesTitle,
                  body: L.colleaguesBody,
                },
                {
                  icon: Globe2,
                  title: L.communityTitle,
                  body: L.communityBody,
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 70}>
                  <div className="landing-strip group flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 transition-all duration-300 hover:border-[#22C55E]/35 hover:bg-[rgba(34,197,94,0.06)] sm:items-center sm:gap-6 sm:px-7 sm:py-6">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#22C55E]/12 text-[#22C55E] transition-transform duration-300 group-hover:scale-110">
                      <item.icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-8">
                      <h3 className="landing-display text-xl tracking-wide text-white sm:text-2xl">
                        {item.title}
                      </h3>
                      <p className="landing-body mt-1 text-sm text-white/50 sm:mt-0 sm:max-w-md sm:text-right">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Competitions — marquee */}
        <section className="relative py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <p className="landing-kicker text-[11px] font-semibold uppercase tracking-[0.28em] text-[#22C55E]">
                {L.compsKicker}
              </p>
              <h2 className="landing-display mt-3 text-4xl tracking-wide text-white sm:text-5xl">
                {L.compsTitle}
              </h2>
              <p className="landing-body mt-3 max-w-xl text-white/55">
                {L.compsIntro}
              </p>
            </Reveal>
          </div>

          <div className="landing-marquee mt-12" aria-label={L.compsAria}>
            <div className="landing-marquee-track">
              {[...COMPETITIONS, ...COMPETITIONS].map((c, i) => (
                <div key={`${c.name}-${i}`} className="landing-marquee-item">
                  <img
                    src={c.logo}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 object-contain sm:h-12 sm:w-12"
                    width={48}
                    height={48}
                    loading="lazy"
                  />
                  <span className="landing-body text-xs font-medium text-white/70 sm:text-sm">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* App */}
        <section id="app" className="relative border-t border-white/[0.07] py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:grid-cols-2 sm:gap-16 sm:px-6">
            <Reveal>
              <p className="landing-kicker text-[11px] font-semibold uppercase tracking-[0.28em] text-[#22C55E]">
                {L.appKicker}
              </p>
              <h2 className="landing-display mt-3 text-4xl tracking-wide text-white sm:text-5xl">
                {L.appTitle}
              </h2>
              <p className="landing-body mt-4 max-w-md leading-relaxed text-white/55">
                {L.appBody}
              </p>
              <div
                className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-5 py-2.5"
                role="status"
              >
                <Smartphone className="h-4 w-4 text-[#22C55E]" aria-hidden />
                <span className="landing-display text-sm tracking-[0.12em] text-[#22C55E]">
                  {L.appSoonBadge}
                </span>
              </div>
            </Reveal>

            <Reveal delay={120} className="relative mx-auto w-full max-w-[260px]">
              <div className="landing-phone-glow absolute -inset-8 rounded-full bg-[#22C55E]/15 blur-3xl" aria-hidden />
              <div className="landing-phone relative overflow-hidden rounded-[2.1rem] border border-white/15 bg-[#0C1220]/95 shadow-2xl shadow-black/60">
                <div className="flex h-7 items-center justify-center bg-black/40">
                  <div className="h-1.5 w-16 rounded-full bg-white/20" />
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <img src={SYMBOL_DARK} alt="" className="h-6 w-6 object-contain" />
                    <span className="landing-display text-sm tracking-wide text-white">
                      PRED<span className="text-[#22C55E]">Z</span>
                    </span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3.5">
                    <div className="flex items-center justify-between text-[10px] text-white/45">
                      <span>Sporting</span>
                      <span className="landing-score-reveal font-mono text-lg font-bold tabular-nums text-white">
                        2–1
                      </span>
                      <span>Benfica</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-white/45">Ranking</span>
                      <span className="landing-rank-climb landing-display text-xl text-[#22C55E]">
                        #3
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 flex-1 rounded-lg bg-[#22C55E]/30" />
                    <div className="h-8 flex-1 rounded-lg bg-white/5" />
                    <div className="h-8 flex-1 rounded-lg bg-white/5" />
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-2">
                    <Smartphone className="h-3.5 w-3.5 text-[#22C55E]" />
                    <span className="text-[10px] font-medium text-[#22C55E]">
                      {L.appPreview}
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Arcade — split panels */}
        <section className="relative border-t border-white/[0.07] bg-[#070B14]/55 py-20 backdrop-blur-md sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <p className="landing-kicker text-[11px] font-semibold uppercase tracking-[0.28em] text-[#22C55E]">
                {L.modeKicker}
              </p>
              <h2 className="landing-display mt-3 text-4xl tracking-wide text-white sm:text-5xl">
                {L.modeTitle}
              </h2>
              <p className="landing-body mt-3 max-w-xl text-white/55">
                {L.modeIntro}
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 sm:gap-5">
              <Reveal delay={40}>
                <div className="landing-panel group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-7 sm:p-9">
                  <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-[#22C55E]/10 blur-2xl transition-opacity group-hover:opacity-100" aria-hidden />
                  <Sparkles className="relative h-8 w-8 text-[#22C55E]" strokeWidth={1.6} />
                  <h3 className="landing-display relative mt-5 text-3xl tracking-wide text-white">
                    {L.wildcardTitle}
                  </h3>
                  <p className="landing-body relative mt-3 text-sm leading-relaxed text-white/50">
                    {L.wildcardBody}
                  </p>
                </div>
              </Reveal>
              <Reveal delay={110}>
                <div className="landing-panel group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-orange-500/[0.08] to-transparent p-7 sm:p-9">
                  <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-orange-400/15 blur-2xl" aria-hidden />
                  <Flame className="relative h-8 w-8 text-orange-400" strokeWidth={1.6} />
                  <h3 className="landing-display relative mt-5 text-3xl tracking-wide text-white">
                    {L.streakTitle}
                  </h3>
                  <p className="landing-body relative mt-3 text-sm leading-relaxed text-white/50">
                    {L.streakBody}
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 sm:py-32">
          <Reveal className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <h2 className="landing-display text-4xl tracking-wide text-white sm:text-6xl">
              {L.finalTitle1}
              <br />
              <span className="text-[#22C55E]">{L.finalTitle2}</span>
            </h2>
            <p className="landing-body mx-auto mt-5 max-w-md text-white/55">
              {L.finalBody}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth"
                className="landing-btn-primary inline-flex h-12 items-center rounded-full bg-[#22C55E] px-8 text-base font-semibold text-[#070B14]"
              >
                {L.signUp}
              </Link>
              <Link
                to="/auth"
                className="inline-flex h-12 items-center rounded-full border border-white/20 bg-white/[0.04] px-8 text-base font-medium text-white transition-colors hover:bg-white/[0.08]"
              >
                {L.signIn}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-white/[0.07] bg-[#070B14]/80 py-10 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <img
              src={SYMBOL_DARK}
              alt=""
              className="h-7 w-7 object-contain sm:h-9 sm:w-9 lg:h-11 lg:w-11"
            />
            <span className="landing-display text-xl tracking-wide text-white sm:text-2xl lg:text-[1.85rem]">
              PRED<span className="text-[#22C55E]">Z</span>
            </span>
          </div>
          <div className="landing-body max-w-lg space-y-2 text-xs leading-relaxed text-white/40">
            <p>{L.footerAbout}</p>
            <p>{L.footerData}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <a href="mailto:suporte@predz.app" className="hover:text-white/70">
                {L.contact}: suporte@predz.app
              </a>
              <Link to="/terms" className="hover:text-white/70">
                {L.terms}
              </Link>
              <Link to="/privacy" className="hover:text-white/70">
                {L.privacy}
              </Link>
            </p>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
