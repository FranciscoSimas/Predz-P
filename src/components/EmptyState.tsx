import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed rounded-2xl bg-card px-6 py-10 text-center flex flex-col items-center">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-accent text-primary grid place-items-center mb-3">
          {icon}
        </div>
      )}
      <p className="font-semibold text-base">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
