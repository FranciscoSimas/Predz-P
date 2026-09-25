import { Binoculars, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type JoinMode = "player" | "spectator";

export type JoinTournamentPreview = {
  name: string;
  description?: string | null;
  competitionName: string;
  competitionLogoUrl?: string | null;
  memberCount?: number;
  isOfficial?: boolean;
  isPublic?: boolean;
  joinCode?: string;
};

export function JoinTournamentDialog({
  open,
  onOpenChange,
  preview,
  loading = false,
  error,
  joiningMode,
  onJoin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: JoinTournamentPreview | null;
  loading?: boolean;
  error?: string | null;
  joiningMode?: JoinMode | null;
  onJoin: (mode: JoinMode) => void | Promise<void>;
}) {
  const { t } = useT();
  const j = t.join;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{j.chooseTitle}</DialogTitle>
          <DialogDescription>{j.chooseSubtitle}</DialogDescription>
        </DialogHeader>

        {loading && <div className="h-64 rounded-xl bg-muted animate-pulse" />}

        {!loading && error && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && preview && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
              <CompetitionBadge
                name={preview.competitionName}
                logoUrl={preview.competitionLogoUrl}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{preview.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {preview.competitionName}
                </p>
                {preview.description?.trim() ? (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {preview.description}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  {preview.joinCode ? (
                    <span className="rounded bg-background px-1.5 py-0.5 font-mono tracking-widest">
                      {preview.joinCode}
                    </span>
                  ) : null}
                  {preview.memberCount != null ? (
                    <span className="rounded bg-background px-1.5 py-0.5">
                      {preview.memberCount === 1
                        ? j.memberOne
                        : j.memberMany.replace("{n}", String(preview.memberCount))}
                    </span>
                  ) : null}
                  {preview.isOfficial ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                      {t.tournament.official}
                    </span>
                  ) : preview.isPublic ? (
                    <span className="rounded bg-background px-1.5 py-0.5">
                      {t.tournament.public}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <JoinOption
                title={j.playerTitle}
                description={j.playerDesc}
                button={j.enter}
                icon={<Trophy className="h-8 w-8" />}
                tone="player"
                loading={joiningMode === "player"}
                disabled={!!joiningMode}
                onClick={() => onJoin("player")}
              />
              <JoinOption
                title={j.spectatorTitle}
                description={j.spectatorDesc}
                button={j.enter}
                icon={<Binoculars className="h-8 w-8" />}
                tone="spectator"
                loading={joiningMode === "spectator"}
                disabled={!!joiningMode}
                onClick={() => onJoin("spectator")}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {j.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinOption({
  title,
  description,
  button,
  icon,
  tone,
  loading,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  button: string;
  icon: ReactNode;
  tone: JoinMode;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const player = tone === "player";
  return (
    <section
      className={cn(
        "flex min-h-52 flex-col rounded-2xl border p-5",
        player
          ? "border-primary/35 bg-primary/5"
          : "border-sky-500/35 bg-sky-500/5 dark:border-sky-400/35",
      )}
    >
      <div
        className={cn(
          "mb-4 grid h-14 w-14 place-items-center rounded-2xl",
          player
            ? "bg-primary/15 text-primary"
            : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        )}
      >
        {icon}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{description}</p>
      <Button
        type="button"
        className={cn("mt-5 w-full", !player && "bg-sky-600 text-white hover:bg-sky-700")}
        disabled={disabled}
        onClick={onClick}
      >
        {loading ? "…" : button}
      </Button>
    </section>
  );
}
