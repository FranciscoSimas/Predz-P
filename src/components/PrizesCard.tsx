import { Card } from "@/components/ui/card";
import { Info, Trophy } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { CustomPrize } from "@/components/PrizesForm";

export type PrizesCardData = {
  prizes_enabled: boolean;
  prize_entry_amount: number;
  prize_entry_currency: string;
  prize_pct_first: number;
  prize_pct_second: number;
  prize_pct_third: number;
  prize_custom: CustomPrize[];
};

export type PlacePrize = {
  place: 1 | 2 | 3;
  amount: number;
  pct: number;
  label: string;
};

/** Cash prize for a podium place, or null if prizes off / 0%. */
export function getPlacePrize(
  data: PrizesCardData | null | undefined,
  memberCount: number,
  place: 1 | 2 | 3,
): PlacePrize | null {
  if (!data?.prizes_enabled || data.prize_entry_amount <= 0) return null;
  const pct =
    place === 1
      ? data.prize_pct_first
      : place === 2
        ? data.prize_pct_second
        : data.prize_pct_third;
  if (pct <= 0) return null;
  const total = data.prize_entry_amount * Math.max(1, memberCount);
  return {
    place,
    amount: (total * pct) / 100,
    pct,
    label: data.prize_entry_currency,
  };
}

export function PrizesCard({
  data,
  memberCount,
  compact = false,
  showPlaceBreakdown = false,
}: {
  data: PrizesCardData | null | undefined;
  memberCount: number;
  compact?: boolean;
  /** When false (default), place % amounts are shown on ranking rows instead. */
  showPlaceBreakdown?: boolean;
}) {
  const { t, formatMoney } = useT();
  const p = t.prizes;
  if (!data?.prizes_enabled) return null;
  const total = data.prize_entry_amount * Math.max(1, memberCount);
  const rows: Array<{ place: string; text: string }> = [];
  if (showPlaceBreakdown) {
    if (data.prize_pct_first > 0)
      rows.push({
        place: p.firstShort,
        text: `${formatMoney((total * data.prize_pct_first) / 100, data.prize_entry_currency)} · ${data.prize_pct_first}%`,
      });
    if (data.prize_pct_second > 0)
      rows.push({
        place: p.secondShort,
        text: `${formatMoney((total * data.prize_pct_second) / 100, data.prize_entry_currency)} · ${data.prize_pct_second}%`,
      });
    if (data.prize_pct_third > 0)
      rows.push({
        place: p.thirdShort,
        text: `${formatMoney((total * data.prize_pct_third) / 100, data.prize_entry_currency)} · ${data.prize_pct_third}%`,
      });
  }

  return (
    <Card className={`p-3 shadow-card ${compact ? "" : "sm:p-5"}`}>
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-primary shrink-0" />
        <p className="font-semibold text-sm sm:text-base">{p.dashboardTitle}</p>
      </div>

      {data.prize_entry_amount > 0 && (
        <div className={`mt-2 rounded-lg bg-muted/60 ${compact ? "p-2.5" : "mt-3 p-3"}`}>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {p.estimatedPot}
          </p>
          <p className={`font-extrabold tabular mt-0.5 ${compact ? "text-xl" : "text-2xl"}`}>
            {formatMoney(total, data.prize_entry_currency)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatMoney(data.prize_entry_amount, data.prize_entry_currency)} {p.perMember} ·{" "}
            {memberCount} {p.members}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.place}
              className="flex items-center justify-between text-sm border-b last:border-0 pb-1.5 last:pb-0"
            >
              <span className="font-semibold">{r.place}</span>
              <span className="tabular text-muted-foreground">{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      {data.prize_custom.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            {p.custom}
          </p>
          <ul className="space-y-1">
            {data.prize_custom.map((c, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="font-semibold shrink-0">{c.place || "-"}</span>
                <span className="text-muted-foreground">{c.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground inline-flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>{p.disclaimer}</span>
      </p>
    </Card>
  );
}
