import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureDevAccessAllowed, isDevHost } from "@/lib/dev-environment";
import { rememberPostAuthPath } from "@/lib/post-auth-redirect";

async function requireUser(retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) return data.user;
    } catch {
      // Network / storage race right after OAuth - retry below.
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  return null;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await requireUser();
    if (!user) {
      // Client-only route (ssr: false): preserve invite links across login.
      if (typeof window !== "undefined") {
        rememberPostAuthPath(`${window.location.pathname}${window.location.search}`);
      } else {
        rememberPostAuthPath(`${location.pathname}${location.searchStr || ""}`);
      }
      throw redirect({ to: "/auth" });
    }

    if (isDevHost()) {
      const allowed = await ensureDevAccessAllowed(user.id);
      if (!allowed) {
        throw redirect({
          to: "/auth",
          search: { reason: "dev_admins_only" },
        });
      }
    }

    return { user };
  },
  component: () => <Outlet />,
});
