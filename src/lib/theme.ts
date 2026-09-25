export type Theme = "light" | "dark";

const KEY = "predz-theme";
const LEGACY_KEY = "palpita-theme";

export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === "dark" || legacy === "light") {
        localStorage.setItem(KEY, legacy);
        v = legacy;
      }
    }
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export function initTheme(): Theme {
  const stored = getStoredTheme();
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme: Theme = stored ?? (prefersDark ? "dark" : "light");
  applyTheme(theme);
  return theme;
}

// Inline script placed in <head> to avoid FOUC on first paint.
export const themeBootstrapScript = `(function(){try{var k='predz-theme';var l='palpita-theme';var v=localStorage.getItem(k);if(!v){var old=localStorage.getItem(l);if(old==='dark'||old==='light'){v=old;localStorage.setItem(k,old);}}var d=v?v==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',!!d);}catch(e){}})();`;
