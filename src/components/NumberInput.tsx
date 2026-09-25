import * as React from "react";
import { Input } from "@/components/ui/input";

type NumberInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  value: number;
  onChange: (n: number) => void;
  /** When empty on blur: restore last value (default), use min, or 0. */
  emptyFallback?: "restore" | "min" | "zero";
};

/**
 * Numeric field that can be temporarily empty while editing.
 * Does not coerce "" → 0 mid-edit (avoids "2" → clear → "0" → type "3" → "03").
 * Empty/invalid values are not saved; blur restores a valid number.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onChange,
      min,
      max,
      step,
      onBlur,
      onFocus,
      emptyFallback = "restore",
      inputMode,
      ...props
    },
    ref,
  ) => {
    const [draft, setDraft] = React.useState(() => formatDraft(value));
    const focusedRef = React.useRef(false);
    const valueRef = React.useRef(value);
    valueRef.current = value;

    React.useEffect(() => {
      if (!focusedRef.current) setDraft(formatDraft(value));
    }, [value]);

    function parseAndClamp(raw: string): number | null {
      const trimmed = raw.trim();
      if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
        return null;
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      let next = n;
      const minN = toFinite(min);
      const maxN = toFinite(max);
      if (minN != null) next = Math.max(minN, next);
      if (maxN != null) next = Math.min(maxN, next);
      return next;
    }

    function resolveEmpty(): number {
      if (emptyFallback === "zero") return 0;
      const minN = toFinite(min);
      if (emptyFallback === "min" && minN != null) return minN;
      if (Number.isFinite(valueRef.current)) return valueRef.current;
      if (minN != null) return minN;
      return 0;
    }

    return (
      <Input
        ref={ref}
        type="number"
        inputMode={inputMode ?? "decimal"}
        min={min}
        max={max}
        step={step}
        value={draft}
        onFocus={(e) => {
          focusedRef.current = true;
          onFocus?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Allow empty / incomplete while typing — do not force 0.
          const parsed = parseAndClamp(raw);
          if (parsed == null) return;
          // Only commit when within bounds already (parseAndClamp clamps);
          // skip live commit if user is mid-edit below min (e.g. clearing).
          const minN = toFinite(min);
          const maxN = toFinite(max);
          const rawN = Number(raw);
          if (!Number.isFinite(rawN)) return;
          if (minN != null && rawN < minN) return;
          if (maxN != null && rawN > maxN) return;
          onChange(parsed);
        }}
        onBlur={(e) => {
          focusedRef.current = false;
          const next = parseAndClamp(draft) ?? resolveEmpty();
          onChange(next);
          setDraft(formatDraft(next));
          onBlur?.(e);
        }}
        {...props}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";

function formatDraft(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(n);
}

function toFinite(v: React.ComponentProps<"input">["min"]): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
