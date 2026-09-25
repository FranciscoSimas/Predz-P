/** Prefer manual override when sync provider crest is stale. */
export function teamCrestUrl(team: {
  crest_url?: string | null;
  crest_override_url?: string | null;
} | null | undefined): string | null {
  if (!team) return null;
  const raw = team.crest_override_url || team.crest_url || null;
  return displayCrestUrl(raw);
}

/**
 * Some club CDNs block hotlinking / tracking-prevention in private tabs.
 * Proxy non-API crests so badges still render.
 */
export function displayCrestUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const trusted =
      host.includes("football-data.org") ||
      host.includes("api-sports.io") ||
      host.includes("media.api-sports.io") ||
      host.endsWith("predz.app") ||
      host.includes("supabase.co") ||
      host.includes("googleusercontent.com");
    if (trusted) return url;
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=png&n=-1`;
  } catch {
    return url;
  }
}
