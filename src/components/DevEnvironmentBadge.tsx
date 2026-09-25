import { useEffect, useState } from "react";
import { isDevHost } from "@/lib/dev-environment";

/** Visible only on DEV hosts so prod tabs are hard to confuse. */
export function DevEnvironmentBadge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isDevHost());
  }, []);

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed top-2 right-2 z-[100] sm:top-3 sm:right-3"
      aria-label="Ambiente de desenvolvimento"
    >
      <span className="inline-flex items-center rounded-md border border-amber-500/50 bg-amber-500/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-950 shadow-md">
        DEV
      </span>
    </div>
  );
}
