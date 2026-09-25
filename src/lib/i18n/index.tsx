import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { pt, type Dict } from "./locales/pt";
import { en } from "./locales/en";
import { supabase } from "@/integrations/supabase/client";

export type Locale = "pt-PT" | "en";
export const LOCALES: { value: Locale; label: string }[] = [
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en", label: "English" },
];

const STORAGE_KEY = "predz-locale";
const dicts: Record<Locale, Dict> = { "pt-PT": pt, en };

/** Browser language → app locale. Unknown languages fall back to English. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const list = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const raw of list) {
    const l = String(raw).toLowerCase();
    if (l === "pt" || l.startsWith("pt-")) return "pt-PT";
    if (l === "en" || l.startsWith("en-")) return "en";
  }
  return "en";
}

/**
 * Resolution order:
 * 1. Saved preference (localStorage / profile)
 * 2. Browser language
 * 3. English
 */
function readStored(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "pt-PT" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return detectBrowserLocale();
}

function applyHtmlLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "en" ? "en" : "pt";
}

type Ctx = {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale, opts?: { persistRemote?: boolean }) => Promise<void>;
  dateLocale: string;
  formatDate: (iso: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  formatMatchTime: (iso: string | Date) => string;
  formatDay: (iso: string | Date) => string;
  formatLabel: (format: string | null | undefined) => string;
  formatMoney: (amount: number, currency: string) => string;
};

const I18nContext = createContext<Ctx | null>(null);

const FORMAT_KEYS = [
  "league",
  "league_phase_then_knockout",
  "knockout_only",
  "groups_then_knockout",
  "groups_then_finals",
  "knockout",
  "cup",
  "group_knockout",
] as const;
type FormatKey = (typeof FORMAT_KEYS)[number];

function buildFormatters(locale: Locale, dict: Dict) {
  const dateLocale = locale === "en" ? "en-GB" : "pt-PT";
  const formatDate = (iso: string | Date, opts?: Intl.DateTimeFormatOptions) => {
    const d = iso instanceof Date ? iso : new Date(iso);
    return d.toLocaleDateString(dateLocale, opts);
  };
  const formatMatchTime = (iso: string | Date) => {
    const d = iso instanceof Date ? iso : new Date(iso);
    return (
      d.toLocaleDateString(dateLocale, {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }) +
      " · " +
      d.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })
    );
  };
  const formatDay = (iso: string | Date) => {
    const d = iso instanceof Date ? iso : new Date(iso);
    return d.toLocaleDateString(dateLocale);
  };
  const formatLabel = (format: string | null | undefined) => {
    if (!format) return "";
    if ((FORMAT_KEYS as readonly string[]).includes(format)) {
      return dict.formats[format as FormatKey];
    }
    return format;
  };
  const formatMoney = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat(dateLocale, {
        style: "currency",
        currency,
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  };
  return { dateLocale, formatDate, formatMatchTime, formatDay, formatLabel, formatMoney };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const initial = readStored();
    setLocaleState(initial);
    applyHtmlLang(initial);
    try {
      localStorage.setItem(STORAGE_KEY, initial);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!active || !data.user) return;

      let stored: Locale | null = null;
      try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "pt-PT" || v === "en") stored = v;
      } catch {
        /* ignore */
      }

      // Prefer this device's saved/browser locale and keep the profile in sync.
      if (stored) {
        setLocaleState(stored);
        applyHtmlLang(stored);
        const { data: prof } = await supabase
          .from("profiles")
          .select("locale")
          .eq("id", data.user.id)
          .maybeSingle();
        const remote = (prof as { locale?: string } | null)?.locale;
        if (remote !== stored) {
          await supabase
            .from("profiles")
            .update({ locale: stored } as never)
            .eq("id", data.user.id);
        }
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("locale")
        .eq("id", data.user.id)
        .maybeSingle();
      const remote = (prof as { locale?: string } | null)?.locale;
      if (remote === "pt-PT" || remote === "en") {
        if (!active) return;
        setLocaleState(remote);
        applyHtmlLang(remote);
        try {
          localStorage.setItem(STORAGE_KEY, remote);
        } catch {
          /* ignore */
        }
      }
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN") load();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const setLocale = useCallback<Ctx["setLocale"]>(async (next, opts) => {
    setLocaleState(next);
    applyHtmlLang(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    if (opts?.persistRemote !== false) {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) {
        await supabase
          .from("profiles")
          .update({ locale: next } as never)
          .eq("id", uid);
      }
    }
  }, []);

  const value = useMemo<Ctx>(() => {
    const dict = dicts[locale];
    const fmt = buildFormatters(locale, dict);
    return {
      locale,
      t: dict,
      setLocale,
      ...fmt,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const fmt = buildFormatters("en", en);
    return {
      locale: "en" as Locale,
      t: en,
      setLocale: async () => {},
      ...fmt,
    };
  }
  return ctx;
}

/** Interpolate {name} placeholders in a translation string. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
