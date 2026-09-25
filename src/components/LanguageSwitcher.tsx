import { Globe } from "lucide-react";
import { LOCALES, useT, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SHORT: Record<Locale, string> = {
  "pt-PT": "PT",
  en: "EN",
};

export function LanguageSwitcher({
  variant = "ghost",
  className,
  showLabel = false,
  light = false,
}: {
  variant?: "ghost" | "outline";
  className?: string;
  showLabel?: boolean;
  /** Landing / auth dark surfaces */
  light?: boolean;
}) {
  const { locale, setLocale, t } = useT();

  return (
    // modal={false}: avoid body scroll-lock that makes sticky headers jump/vanish while scrolled.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          className={cn(
            "h-9 gap-1.5 px-2.5",
            light &&
              "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white",
            className,
          )}
          aria-label={t.settings.language}
        >
          <Globe className="h-4 w-4" />
          {showLabel ? (
            <>
              <span className="hidden sm:inline text-xs font-semibold tracking-wide">
                {SHORT[locale]}
              </span>
              <span className="sr-only sm:hidden">{SHORT[locale]}</span>
            </>
          ) : (
            <span className="sr-only">{SHORT[locale]}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[60] min-w-[10.5rem]">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(v) => {
            void setLocale(v as Locale, { persistRemote: true });
          }}
        >
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
