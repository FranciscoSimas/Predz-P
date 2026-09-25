import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Coins, Gift, Plus, Trash2, Trophy, Users } from "lucide-react";
import { NumberInput } from "@/components/NumberInput";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type CustomPrize = { place: string; description: string };

export type PrizesValue = {
  prizes_enabled: boolean;
  prize_entry_amount: number;
  prize_entry_currency: string;
  prize_pct_first: number;
  prize_pct_second: number;
  prize_pct_third: number;
  prize_custom: CustomPrize[];
};

export const defaultPrizes: PrizesValue = {
  prizes_enabled: false,
  prize_entry_amount: 0,
  prize_entry_currency: "EUR",
  prize_pct_first: 70,
  prize_pct_second: 20,
  prize_pct_third: 10,
  prize_custom: [],
};

/** Normalize a position: "1" → "1º" (PT) or "1st" (EN). */
export function normalizePlaceLabel(raw: string, placeSuffix: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    if (placeSuffix) return `${trimmed}${placeSuffix}`;
    const n = Number(trimmed);
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (mod10 === 1) return `${n}st`;
    if (mod10 === 2) return `${n}nd`;
    if (mod10 === 3) return `${n}rd`;
    return `${n}th`;
  }
  return trimmed;
}

export function PrizesForm({
  value,
  onChange,
  memberCount = 1,
  disabled = false,
}: {
  value: PrizesValue;
  onChange: (next: PrizesValue) => void;
  memberCount?: number;
  disabled?: boolean;
}) {
  const { t, formatMoney: fmtMoney } = useT();
  const p = t.prizes;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimateMembers, setEstimateMembers] = useState(Math.max(1, memberCount));

  useEffect(() => {
    setEstimateMembers((prev) => (prev === 1 && memberCount > 1 ? memberCount : prev));
  }, [memberCount]);

  const sum = value.prize_pct_first + value.prize_pct_second + value.prize_pct_third;
  const sumOk = sum === 100;
  const sumBad = sum !== 100;
  const members = Math.max(1, estimateMembers);
  const totalPot = value.prize_entry_amount * members;

  const places = [
    { key: "first" as const, label: p.first, short: p.firstShort, pct: value.prize_pct_first, field: "prize_pct_first" as const },
    { key: "second" as const, label: p.second, short: p.secondShort, pct: value.prize_pct_second, field: "prize_pct_second" as const },
    { key: "third" as const, label: p.third, short: p.thirdShort, pct: value.prize_pct_third, field: "prize_pct_third" as const },
  ];
  const activePlaces = places.filter((x) => x.pct > 0);

  function patch(part: Partial<PrizesValue>) {
    onChange({ ...value, ...part });
  }
  function setPct(k: "prize_pct_first" | "prize_pct_second" | "prize_pct_third", n: number) {
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
    patch({ [k]: clamped } as Partial<PrizesValue>);
  }
  function addCustom() {
    patch({ prize_custom: [...value.prize_custom, { place: "", description: "" }] });
  }
  function updateCustom(idx: number, part: Partial<CustomPrize>) {
    const next = value.prize_custom.map((c, i) => (i === idx ? { ...c, ...part } : c));
    patch({ prize_custom: next });
  }
  function removeCustom(idx: number) {
    patch({ prize_custom: value.prize_custom.filter((_, i) => i !== idx) });
  }

  function onToggle(want: boolean) {
    if (disabled) return;
    if (want && !value.prizes_enabled) {
      setConfirmOpen(true);
      return;
    }
    patch({ prizes_enabled: want });
  }

  return (
    <div className="space-y-4">
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.disclaimerTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              {p.disclaimerDialog}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              type="button"
              onClick={() => {
                patch({ prizes_enabled: true });
                setConfirmOpen(false);
              }}
            >
              {p.disclaimerConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold inline-flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-primary" /> {p.enable}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{p.enableDesc}</p>
          </div>
          <Switch
            checked={value.prizes_enabled}
            onCheckedChange={onToggle}
            aria-label={p.enable}
            disabled={disabled}
          />
        </div>
      </Card>

      {value.prizes_enabled && (
        <>
          {/* Monetary */}
          <Card className="p-4 sm:p-5 space-y-5 shadow-card border-primary/15">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <Coins className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-bold text-base">{p.monetaryTitle}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{p.monetaryDesc}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_7.5rem] gap-3">
              <div>
                <Label htmlFor="prize-amount">{p.entryAmount}</Label>
                <NumberInput
                  id="prize-amount"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={value.prize_entry_amount}
                  onChange={(n) => patch({ prize_entry_amount: n })}
                  emptyFallback="zero"
                  placeholder="0"
                  className="mt-1.5 h-11 tabular"
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor="prize-currency">{p.entryCurrency}</Label>
                <select
                  id="prize-currency"
                  value={value.prize_entry_currency}
                  onChange={(e) => patch({ prize_entry_currency: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-md border bg-background px-3 text-sm"
                  disabled={disabled}
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="BRL">BRL</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-sm font-semibold">{p.distribution}</p>
                <p
                  className={cn(
                    "text-xs font-medium tabular",
                    sumOk ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {sumBad ? p.sumMust100 : `${p.sumOk}: ${sum}%`}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {places.map((pl) => (
                  <PctField
                    key={pl.key}
                    label={pl.label}
                    value={pl.pct}
                    onChange={(v) => setPct(pl.field, v)}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    {p.estimatedPot}
                  </p>
                  <p className="text-2xl sm:text-3xl font-extrabold tabular mt-0.5">
                    {fmtMoney(totalPot, value.prize_entry_currency)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {fmtMoney(value.prize_entry_amount, value.prize_entry_currency)} {p.perMember}
                  </p>
                </div>
                <div className="w-full sm:w-40">
                  <Label htmlFor="prize-estimate" className="text-xs inline-flex items-center gap-1">
                    <Users className="w-3 h-3" /> {p.estimateMembers}
                  </Label>
                  <NumberInput
                    id="prize-estimate"
                    inputMode="numeric"
                    min={1}
                    max={500}
                    value={estimateMembers}
                    onChange={setEstimateMembers}
                    emptyFallback="min"
                    className="mt-1.5 h-10 tabular"
                    disabled={disabled}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">{p.estimateMembersHint}</p>
                </div>
              </div>

              {activePlaces.length > 0 ? (
                <div
                  className={cn(
                    "grid gap-2",
                    activePlaces.length === 1 && "grid-cols-1 max-w-xs",
                    activePlaces.length === 2 && "grid-cols-2",
                    activePlaces.length >= 3 && "grid-cols-3",
                  )}
                >
                  {activePlaces.map((pl) => (
                    <PodiumBox
                      key={pl.key}
                      place={pl.short}
                      pct={pl.pct}
                      amount={(totalPot * pl.pct) / 100}
                      currency={value.prize_entry_currency}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{p.noMonetaryPlaces}</p>
              )}
            </div>
          </Card>

          {/* Custom */}
          <Card className="p-4 sm:p-5 space-y-4 shadow-card border-primary/15">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <Gift className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-bold text-base">{p.custom}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{p.customDesc}</p>
                <p className="text-xs text-muted-foreground/90 mt-1 italic">{p.customExample}</p>
              </div>
            </div>

            {value.prize_custom.length > 0 && (
              <div className="space-y-2">
                {value.prize_custom.map((c, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[5.5rem_1fr_auto] sm:grid-cols-[6.5rem_1fr_auto] gap-2 items-start"
                  >
                    <PlaceInput
                      value={c.place}
                      placeholder={p.place}
                      placeSuffix={p.placeSuffix}
                      onChange={(place) => updateCustom(idx, { place })}
                      disabled={disabled}
                    />
                    <Input
                      placeholder={p.description}
                      value={c.description}
                      maxLength={200}
                      onChange={(e) => updateCustom(idx, { description: e.target.value })}
                      className="h-10"
                      disabled={disabled}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => removeCustom(idx)}
                      aria-label={p.remove}
                      disabled={disabled}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addCustom}
              disabled={disabled || value.prize_custom.length >= 10}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> {p.addCustom}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function PlaceInput({
  value,
  placeholder,
  placeSuffix,
  onChange,
  disabled,
}: {
  value: string;
  placeholder: string;
  placeSuffix: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const digitsOnly = /^\d+$/.test(value.trim());
  const showSuffix = !!placeSuffix && digitsOnly;

  return (
    <div className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(normalizePlaceLabel(value, placeSuffix))}
        className={cn("h-10", showSuffix && "pr-7")}
        disabled={disabled}
        inputMode="text"
      />
      {showSuffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
          {placeSuffix}
        </span>
      )}
    </div>
  );
}

function PctField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1.5 relative">
        <NumberInput
          inputMode="numeric"
          min={0}
          max={100}
          value={value}
          onChange={onChange}
          className="h-11 tabular pr-8"
          disabled={disabled}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function PodiumBox({
  place,
  pct,
  amount,
  currency,
}: {
  place: string;
  pct: number;
  amount: number;
  currency: string;
}) {
  const { formatMoney: fmtMoney } = useT();
  return (
    <div className="rounded-lg bg-background border p-2.5 text-center shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{place}</p>
      <p className="font-bold tabular text-sm mt-0.5">{fmtMoney(amount, currency)}</p>
      <p className="text-[10px] text-muted-foreground">{pct}%</p>
    </div>
  );
}

/** Deprecated: prefer `useT().formatMoney`. Fallback for module scope. */
export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
