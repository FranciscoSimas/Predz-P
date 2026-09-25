import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, initTheme, type Theme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function ThemeToggle({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  const { t } = useT();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(initTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? t.settings.themeToLight : t.settings.themeToDark}
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
