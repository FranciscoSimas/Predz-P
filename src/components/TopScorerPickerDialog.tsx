import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TeamBadge } from "@/components/TeamBadge";
import { teamCrestUrl } from "@/lib/team-crest";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  crest_override_url?: string | null;
};

type Player = {
  id: string;
  external_id: string;
  name: string;
  photo_url: string | null;
  position: string | null;
  shirt_number: number | null;
  team_id: string | null;
};

export type TopScorerPick = {
  externalId: string;
  name: string;
  teamId: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitionId: string;
  teams: Team[];
  labels: {
    title: string;
    teams: string;
    players: string;
    pickTeam: string;
    confirm: string;
    back: string;
    emptySquad: string;
  };
  onConfirm: (pick: TopScorerPick) => void;
};

export function TopScorerPickerDialog({
  open,
  onOpenChange,
  competitionId,
  teams,
  labels,
  onConfirm,
}: Props) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [playerExt, setPlayerExt] = useState<string | null>(null);
  const [mobileShowPlayers, setMobileShowPlayers] = useState(false);

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["comp-players", competitionId, teamId],
    enabled: open && !!competitionId && !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_players")
        .select("id, external_id, name, photo_url, position, shirt_number, team_id")
        .eq("competition_id", competitionId)
        .eq("team_id", teamId!);
      if (error) throw error;
      const rows = (data ?? []) as Player[];
      const positionOrder: Record<string, number> = {
        Goalkeeper: 0,
        Defender: 1,
        Midfielder: 2,
        Attacker: 3,
      };
      return rows.slice().sort((a, b) => {
        const pa = positionOrder[a.position ?? ""] ?? 99;
        const pb = positionOrder[b.position ?? ""] ?? 99;
        if (pa !== pb) return pa - pb;
        const na = a.shirt_number ?? 9999;
        const nb = b.shirt_number ?? 9999;
        if (na !== nb) return na - nb;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    },
  });

  const selectedPlayer = useMemo(
    () => players.find((p) => p.external_id === playerExt) ?? null,
    [players, playerExt],
  );

  function selectTeam(id: string) {
    setTeamId(id);
    setPlayerExt(null);
    setMobileShowPlayers(true);
  }

  function handleConfirm() {
    if (!selectedPlayer) return;
    onConfirm({
      externalId: selectedPlayer.external_id,
      name: selectedPlayer.name,
      teamId: selectedPlayer.team_id,
    });
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTeamId(null);
      setPlayerExt(null);
      setMobileShowPlayers(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden sm:max-h-[85vh]">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 min-h-[280px] max-h-[60vh]">
          {/* Teams */}
          <div
            className={cn(
              "border-b sm:border-b-0 sm:border-r overflow-y-auto",
              mobileShowPlayers ? "hidden sm:block" : "block",
            )}
          >
            <p className="sticky top-0 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {labels.teams}
            </p>
            <ul className="pb-2">
              {teams.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                      teamId === t.id && "bg-primary/10 text-primary font-medium",
                    )}
                    onClick={() => selectTeam(t.id)}
                  >
                    <TeamBadge
                      name={t.name}
                      shortName={t.short_name}
                      crestUrl={teamCrestUrl(t)}
                      size="sm"
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Players */}
          <div
            className={cn(
              "overflow-y-auto",
              mobileShowPlayers ? "block" : "hidden sm:block",
            )}
          >
            <div className="sticky top-0 bg-background px-3 py-2 flex items-center gap-2 border-b sm:border-0">
              <button
                type="button"
                className="sm:hidden inline-flex items-center gap-1 text-xs text-muted-foreground"
                onClick={() => setMobileShowPlayers(false)}
              >
                <ChevronLeft className="w-4 h-4" />
                {labels.back}
              </button>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {labels.players}
              </p>
            </div>
            {!teamId ? (
              <p className="px-3 py-8 text-sm text-muted-foreground text-center">
                {labels.pickTeam}
              </p>
            ) : isLoading ? (
              <p className="px-3 py-8 text-sm text-muted-foreground text-center">…</p>
            ) : players.length === 0 ? (
              <p className="px-3 py-8 text-sm text-muted-foreground text-center">
                {labels.emptySquad}
              </p>
            ) : (
              <ul className="pb-2">
                {players.map((p) => (
                  <li key={p.external_id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                        playerExt === p.external_id &&
                          "bg-primary/10 text-primary font-medium",
                      )}
                      onClick={() => setPlayerExt(p.external_id)}
                    >
                      {p.photo_url ? (
                        <img
                          src={p.photo_url}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover bg-muted"
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-muted inline-flex items-center justify-center text-[10px] font-bold">
                          {p.shirt_number ?? "·"}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {p.shirt_number != null ? `${p.shirt_number}. ` : ""}
                        {p.name}
                      </span>
                      {p.position ? (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {p.position}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t">
          <Button
            type="button"
            disabled={!selectedPlayer}
            onClick={handleConfirm}
          >
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
