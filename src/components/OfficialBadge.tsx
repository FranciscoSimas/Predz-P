import { ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n";

export function OfficialBadge({
  size = "sm",
  className = "",
}: {
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const { t } = useT();
  const sz =
    size === "md"
      ? "text-xs px-2 py-0.5 gap-1"
      : size === "sm"
        ? "text-[10px] px-1.5 py-0.5 gap-1"
        : "text-[9px] px-1 py-0.5 gap-0.5";
  const icon = size === "md" ? "w-3.5 h-3.5" : size === "sm" ? "w-2.5 h-2.5" : "w-2 h-2";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded font-semibold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 dark:bg-primary/25 dark:text-primary dark:border-primary/50 ${sz} ${className}`}
      title={t.tournament.official}
    >
      <ShieldCheck className={icon} />
      {t.tournament.official}
    </span>
  );
}
