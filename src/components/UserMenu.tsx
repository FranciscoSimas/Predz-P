import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export function UserMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [avatarBroken, setAvatarBroken] = useState(false);

  const { data } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw userErr ?? new Error("Sessão inválida.");
      const u = userRes.user;
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, created_at")
        .eq("id", u.id)
        .maybeSingle();
      if (pErr) throw pErr;
      const oauthAvatar =
        (u.user_metadata?.avatar_url as string | undefined) ??
        (u.user_metadata?.picture as string | undefined) ??
        null;
      return {
        userId: u.id,
        email: u.email ?? "",
        name:
          profile?.display_name ??
          (u.user_metadata?.display_name as string | undefined) ??
          (u.user_metadata?.full_name as string | undefined) ??
          "",
        avatar: profile?.avatar_url ?? null,
        oauthAvatar,
        createdAt: profile?.created_at ?? u.created_at ?? null,
      };
    },
    staleTime: 60_000,
  });

  const name = data?.name ?? data?.email ?? "";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
  const avatar = data?.avatar ?? null;

  useEffect(() => {
    setAvatarBroken(false);
  }, [avatar]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const showAvatar = !!avatar && !avatarBroken;

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" asChild aria-label={t.nav.profile}>
        <Link to="/profile">
          <span className="relative w-7 h-7">
            <span className="absolute inset-0 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
              {initials || <UserIcon className="w-4 h-4" />}
            </span>
            {showAvatar && (
              <img
                src={avatar!}
                alt=""
                className="absolute inset-0 w-7 h-7 rounded-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setAvatarBroken(true)}
              />
            )}
          </span>
        </Link>
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t.common.signOut}>
            <LogOut className="w-4 h-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.settings.signOutConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.settings.signOutConfirmDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>{t.common.signOut}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
