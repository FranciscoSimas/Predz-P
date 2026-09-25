import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { getStoredTheme, type Theme } from "@/lib/theme";

function useResolvedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const read = () =>
      document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(getStoredTheme() ?? read());

    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  return theme;
}

export function AppBrand({
  withTagline = false,
  size = "md",
  to = "/",
}: {
  withTagline?: boolean;
  size?: "sm" | "md" | "lg";
  /** Destination when clicking the brand (e.g. `/home` inside the app). */
  to?: "/home" | "/";
}) {
  const { t } = useT();
  const theme = useResolvedTheme();
  const logo = size === "lg" ? "w-14 h-14" : size === "sm" ? "w-8 h-8 sm:w-9 sm:h-9" : "w-9 h-9 sm:w-10 sm:h-10";
  const title = size === "lg" ? "text-4xl" : size === "sm" ? "text-base sm:text-lg" : "text-lg sm:text-xl";
  const tagline = size === "lg" ? "text-[13px] mt-1" : "text-[11px] mt-0.5";
  const symbolSrc =
    theme === "dark"
      ? "/brand/symbol-dark.png?v=4"
      : "/brand/symbol-light.png?v=4";

  return (
    <Link to={to} className="flex items-center gap-2.5 group shrink-0">
      <img
        src={symbolSrc}
        alt="Predz"
        className={`${logo} object-contain shrink-0 bg-transparent`}
        width={512}
        height={512}
      />
      <span className="flex flex-col leading-none">
        <span className={`${title} brand-wordmark tracking-tight`}>
          <span className="text-foreground">PRED</span>
          <span className="text-primary">Z</span>
        </span>
        {withTagline && (
          <span className={`${tagline} text-muted-foreground uppercase tracking-wider`}>
            {t.brand.tagline}
          </span>
        )}
      </span>
    </Link>
  );
}
