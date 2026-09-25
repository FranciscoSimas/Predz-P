import { Star } from "lucide-react";

export function WildcardBadge({ multiplier, className = "" }: { multiplier: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gold/25 text-gold-foreground dark:text-gold border border-gold/50 dark:bg-gold/20 ${className}`}
      title={`Wildcard ×${multiplier}`}
    >
      <Star className="w-3 h-3 fill-current" />×{multiplier}
    </span>
  );
}
