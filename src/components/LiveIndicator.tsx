import { useT } from "@/lib/i18n";

export function LiveIndicator({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
      <span className="w-1.5 h-1.5 rounded-full bg-destructive pulse-live" />
      {label ?? t.live.label}
    </span>
  );
}
