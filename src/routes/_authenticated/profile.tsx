import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle, LogOut, User as UserIcon } from "lucide-react";
import { LOCALES, useT, type Locale } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/profile")({
  component: SettingsPage,
});

type ProfileData = {
  userId: string;
  email: string;
  name: string;
  avatar: string | null;
  oauthAvatar: string | null;
  createdAt: string | null;
};

function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, locale, setLocale, dateLocale } = useT();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<ProfileData> => {
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
  });

  const [name, setName] = useState("");
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const customFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setAvatarBroken(false);
    }
  }, [data]);

  const trimmed = name.trim();
  const nameChanged = !!data && trimmed !== data.name.trim();
  const nameValid = trimmed.length > 0 && trimmed.length <= 50;

  const displayAvatar = data?.avatar ?? null;
  const avatarMode: "initials" | "oauth" | "custom" = !displayAvatar
    ? "initials"
    : data?.oauthAvatar && displayAvatar === data.oauthAvatar
      ? "oauth"
      : "custom";

  async function setAvatarUrl(url: string | null) {
    if (!data) return;
    setAvatarSaving(true);
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", data.userId);
    setAvatarSaving(false);
    if (updErr) return toast.error(updErr.message);
    setAvatarBroken(false);
    toast.success(t.settings.avatarSaved);
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  }

  async function onCustomFile(file: File | null) {
    if (!data || !file) return;
    if (!file.type.startsWith("image/")) {
      return toast.error(t.settings.avatarUploadError);
    }
    setAvatarSaving(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${data.userId}/avatar.${ext === "jpeg" ? "jpg" : ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (upErr) {
      setAvatarSaving(false);
      return toast.error(upErr.message || t.settings.avatarUploadError);
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", data.userId);
    setAvatarSaving(false);
    if (updErr) return toast.error(updErr.message);
    setAvatarBroken(false);
    toast.success(t.settings.avatarSaved);
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !nameChanged || !nameValid) return;
    setSaving(true);
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ display_name: trimmed })
      .eq("id", data.userId);
    setSaving(false);
    if (updErr) {
      const msg = updErr.message?.toLowerCase() ?? "";
      if (
        updErr.code === "23505" ||
        msg.includes("profiles_display_name_ci") ||
        msg.includes("unique") ||
        msg.includes("duplicate")
      ) {
        return toast.error(t.settings.nameTaken);
      }
      return toast.error(updErr.message);
    }
    toast.success(t.settings.profileUpdated);
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto space-y-5">
          <div className="h-8 w-32 bg-muted rounded animate-pulse" />
          <div className="h-28 rounded-xl bg-muted animate-pulse" />
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto">
          <Card className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? t.settings.loadError}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t.common.retry}
            </Button>
          </Card>
        </div>
      </AppShell>
    );
  }

  const initials = (name || data.email || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const showAvatar = !!displayAvatar && !avatarBroken;

  return (
    <AppShell>
      <div className="max-w-xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display tracking-wide">{t.settings.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.settings.subtitle}</p>
        </div>

        {/* Account */}
        <Card className="p-5 sm:p-6 shadow-card space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 shrink-0">
              <span className="absolute inset-0 rounded-2xl gradient-hero text-white grid place-items-center text-xl font-bold">
                {initials || <UserIcon className="w-6 h-6" />}
              </span>
              {showAvatar && (
                <img
                  src={displayAvatar!}
                  alt=""
                  className="absolute inset-0 w-16 h-16 rounded-2xl object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{data.name || t.home.player}</p>
              <p className="text-sm text-muted-foreground truncate">{data.email}</p>
              {data.createdAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.settings.memberSince}{" "}
                  {new Date(data.createdAt).toLocaleDateString(dateLocale, {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">{t.settings.avatarSection}</p>
            <p className="text-xs text-muted-foreground">{t.settings.avatarSectionDesc}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                type="button"
                variant={avatarMode === "initials" ? "default" : "outline"}
                className="h-10"
                disabled={avatarSaving}
                onClick={() => void setAvatarUrl(null)}
              >
                {t.settings.avatarInitials}
              </Button>
              <Button
                type="button"
                variant={avatarMode === "oauth" ? "default" : "outline"}
                className="h-10"
                disabled={avatarSaving || !data.oauthAvatar}
                onClick={() => {
                  if (!data.oauthAvatar) return toast.error(t.settings.avatarNoGoogle);
                  void setAvatarUrl(data.oauthAvatar);
                }}
              >
                {t.settings.avatarGoogle}
              </Button>
              <Button
                type="button"
                variant={avatarMode === "custom" ? "default" : "outline"}
                className="h-10"
                disabled={avatarSaving}
                onClick={() => customFileRef.current?.click()}
              >
                {t.settings.avatarCustom}
              </Button>
              <input
                ref={customFileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={avatarSaving}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void onCustomFile(f);
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">{t.settings.avatarUpload}</p>
          </div>

          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="name">{t.settings.displayName}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 h-11"
                maxLength={50}
                required
              />
              {!nameValid && trimmed.length === 0 && (
                <p className="text-xs text-destructive mt-1">{t.settings.nameEmpty}</p>
              )}
            </div>
            <div>
              <Label htmlFor="email">{t.common.email}</Label>
              <Input id="email" value={data.email} disabled className="mt-1.5 h-11 opacity-70" />
            </div>
            <Button
              type="submit"
              className="w-full h-11"
              disabled={saving || !nameChanged || !nameValid}
            >
              {saving ? t.common.saving : t.common.save}
            </Button>
          </form>
        </Card>

        {/* Appearance */}
        <Card className="p-5 sm:p-6 shadow-card flex items-center justify-between">
          <div>
            <p className="font-semibold">{t.settings.appearance}</p>
            <p className="text-xs text-muted-foreground">{t.settings.appearanceDesc}</p>
          </div>
          <ThemeToggle variant="outline" />
        </Card>

        {/* Language */}
        <Card className="p-5 sm:p-6 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold">{t.settings.language}</p>
              <p className="text-xs text-muted-foreground">{t.settings.languageDesc}</p>
            </div>
            <Select
              value={locale}
              onValueChange={(v) => {
                void setLocale(v as Locale);
              }}
            >
              <SelectTrigger className="w-[200px] h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Session */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full h-11">
              <LogOut className="w-4 h-4 mr-2" /> {t.common.signOut}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.settings.signOutConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.settings.signOutConfirmDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={signOut}>{t.common.signOut}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
