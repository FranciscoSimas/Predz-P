import { Flame } from "lucide-react";
import { useT } from "@/lib/i18n";

export function StreakIndicator({
  current,
  best,
  className = "",
}: {
  current: number;
  best?: number;
  className?: string;
}) {
  const { t } = useT();
  const hot = current >= 3;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${
        hot
          ? "bg-orange-500/20 text-orange-600 dark:bg-orange-500/25 dark:text-orange-300 animate-pulse"
          : "bg-muted text-muted-foreground"
      } ${className}`}
      title={
        [
          best != null ? `${t.streak.bestPrefix} ${best}` : null,
          t.streak.hint,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    >
      <Flame className={`w-3.5 h-3.5 ${hot ? "fill-current" : ""}`} />
      {current}
    </span>
  );
}
