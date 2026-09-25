const STORAGE_KEY = "predz_post_auth_path";

/** Paths we allow returning to after login (relative only). */
function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.startsWith("/auth")) return false;
  return true;
}

export function rememberPostAuthPath(pathWithSearch: string) {
  if (typeof window === "undefined") return;
  if (!isSafeInternalPath(pathWithSearch)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, pathWithSearch);
  } catch {
    /* private mode / quota */
  }
}

export function peekPostAuthPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (!v || !isSafeInternalPath(v)) return null;
    return v;
  } catch {
    return null;
  }
}

export function takePostAuthPath(): string | null {
  const v = peekPostAuthPath();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return v;
}

/** Navigate to the saved post-auth path, or /home. */
export function goPostAuth(
  navigate: (opts: { to: string; search?: Record<string, string>; replace?: boolean }) => void,
) {
  const path = takePostAuthPath();
  if (!path) {
    navigate({ to: "/home", replace: true });
    return;
  }
  const qIndex = path.indexOf("?");
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const search: Record<string, string> = {};
  if (qIndex >= 0) {
    new URLSearchParams(path.slice(qIndex + 1)).forEach((value, key) => {
      search[key] = value;
    });
  }
  navigate({
    to: pathname,
    search: Object.keys(search).length ? search : undefined,
    replace: true,
  });
}

export function rememberJoinCode(code: string) {
  const cleaned = code.trim().toUpperCase();
  if (!cleaned) return;
  rememberPostAuthPath(`/join?code=${encodeURIComponent(cleaned)}`);
}
