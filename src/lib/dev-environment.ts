import { supabase } from "@/integrations/supabase/client";

/** Hostnames that serve the `dev` branch (never production). */
export const DEV_HOSTS = new Set(["dev.predz.app", "fantasy-futebol.vercel.app"]);

export function isDevHost(hostname?: string): boolean {
  const host =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  return !!host && DEV_HOSTS.has(host);
}

export async function isCurrentUserPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * On DEV hosts, only platform admins may stay signed in.
 * Returns true if access is allowed (or host is not DEV).
 */
export async function ensureDevAccessAllowed(userId: string): Promise<boolean> {
  if (!isDevHost()) return true;
  const ok = await isCurrentUserPlatformAdmin(userId);
  if (!ok) {
    await supabase.auth.signOut();
  }
  return ok;
}
