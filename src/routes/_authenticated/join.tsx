import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  JoinTournamentDialog,
  type JoinMode,
} from "@/components/JoinTournamentDialog";

type JoinSearch = { code?: string };

type PreviewRow = {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  is_official: boolean;
  join_code: string;
  competition_name: string;
  competition_logo_url: string | null;
  member_count: number;
  already_member: boolean;
};

export const Route = createFileRoute("/_authenticated/join")({
  validateSearch: (search: Record<string, unknown>): JoinSearch => ({
    code: typeof search.code === "string" ? search.code.trim().toUpperCase() : undefined,
  }),
  component: JoinPage,
});

function JoinPage() {
  const navigate = useNavigate();
  const { t } = useT();
  const { code: codeFromUrl } = Route.useSearch();
  const [code, setCode] = useState(codeFromUrl ?? "");
  const [joiningMode, setJoiningMode] = useState<JoinMode | null>(null);
  const [activeCode, setActiveCode] = useState(codeFromUrl ?? "");
  const [modalOpen, setModalOpen] = useState(!!codeFromUrl);

  useEffect(() => {
    if (codeFromUrl) {
      setCode(codeFromUrl);
      setActiveCode(codeFromUrl);
      setModalOpen(true);
    }
  }, [codeFromUrl]);

  const inviteCode = activeCode.trim().toUpperCase();
  const { data: preview, isFetching: previewLoading, error: previewError } = useQuery({
    queryKey: ["preview-tournament", inviteCode],
    enabled: !!inviteCode && inviteCode.length >= 4 && modalOpen,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_tournament_by_code", {
        _code: inviteCode,
      });
      if (error) throw error;
      const rows = (data ?? []) as PreviewRow[];
      return rows[0] ?? null;
    },
  });

  useEffect(() => {
    if (!preview?.already_member) return;
    toast.success(t.join.alreadyMember);
    navigate({ to: "/t/$id", params: { id: preview.id }, replace: true });
  }, [preview, navigate, t.join.alreadyMember]);

  async function joinWithCode(raw: string, mode: JoinMode) {
    const cleaned = raw.trim().toUpperCase();
    if (!cleaned) return;
    setJoiningMode(mode);
    const { data, error } = await supabase.rpc("join_tournament_by_code_as", {
      _code: cleaned,
      _as_spectator: mode === "spectator",
    });
    setJoiningMode(null);
    if (error) return toast.error(error.message);
    toast.success(t.join.joinedOk);
    navigate({ to: "/t/$id", params: { id: data as string } });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    setActiveCode(cleaned);
    setModalOpen(true);
    navigate({ to: "/join", search: { code: cleaned }, replace: true });
  }

  function closeInviteModal() {
    setModalOpen(false);
    navigate({ to: "/join", search: {}, replace: true });
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        <Card className="p-6 sm:p-8 shadow-card">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl gradient-hero text-white inline-flex items-center justify-center mb-3 shadow-card">
              <KeyRound className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-display tracking-wide">{t.join.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.join.subtitle}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t.join.placeholder}
              maxLength={6}
              className="h-14 text-center text-2xl tracking-[0.4em] font-mono uppercase"
              autoFocus={!codeFromUrl}
              inputMode="text"
              autoCapitalize="characters"
            />
            <Button type="submit" className="w-full h-12" disabled={code.length < 4}>
              {t.join.submit}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-4">{t.join.hint}</p>
        </Card>
      </div>

      <JoinTournamentDialog
        open={modalOpen && !!inviteCode}
        onOpenChange={(open) => {
          if (!open) closeInviteModal();
        }}
        preview={
          preview && !preview.already_member
            ? {
                name: preview.name,
                description: preview.description,
                competitionName: preview.competition_name,
                competitionLogoUrl: preview.competition_logo_url,
                memberCount: preview.member_count,
                isOfficial: preview.is_official,
                isPublic: preview.is_public,
                joinCode: preview.join_code,
              }
            : null
        }
        loading={previewLoading}
        error={
          previewError instanceof Error
            ? previewError.message
            : !previewLoading && !preview
              ? t.join.notFound
              : null
        }
        joiningMode={joiningMode}
        onJoin={(mode) => joinWithCode(inviteCode, mode)}
      />
    </AppShell>
  );
}
