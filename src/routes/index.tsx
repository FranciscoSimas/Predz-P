import { createFileRoute, redirect } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";
import { supabase } from "@/integrations/supabase/client";

const HOME_TITLE = "PredZ";
const HOME_DESCRIPTION =
  "Football score prediction tournaments with friends. Pick real match results, climb live rankings, optional top scorer and league winner. Private pools or public PredZ tournaments. Free, no money on the platform.";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "PredZ",
  url: "https://predz.app/",
  description: HOME_DESCRIPTION,
  inLanguage: ["pt-PT", "en"],
  publisher: { "@id": "https://predz.app/#organization" },
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://predz.app/#organization",
  name: "PredZ",
  url: "https://predz.app/",
  email: "suporte@predz.app",
  logo: {
    "@type": "ImageObject",
    url: "https://predz.app/brand/app-icon-512.png",
    width: 512,
    height: 512,
  },
  image: "https://predz.app/brand/og-1200x630.png",
};

export const Route = createFileRoute("/")({
  // SSR on: Google needs real HTML for the homepage (privacy was winning because it SSR'd).
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: "description", content: HOME_DESCRIPTION },
      {
        name: "keywords",
        content:
          "predz, prognósticos, fantasy football, torneio amigos, ranking, liga portugal, futebol",
      },
      { property: "og:title", content: HOME_TITLE },
      { property: "og:description", content: HOME_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "PredZ" },
      { property: "og:url", content: "https://predz.app/" },
      { property: "og:image", content: "https://predz.app/brand/og-1200x630.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: HOME_TITLE },
      { name: "twitter:description", content: HOME_DESCRIPTION },
      { name: "application-name", content: "PredZ" },
      { name: "apple-mobile-web-app-title", content: "PredZ" },
    ],
    links: [
      { rel: "canonical", href: "https://predz.app/" },
      { rel: "icon", href: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", href: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
      { rel: "icon", href: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(websiteJsonLd),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(orgJsonLd),
      },
    ],
  }),
  beforeLoad: async () => {
    // Skip auth redirect during SSR so crawlers always get the landing HTML.
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
  },
  component: LandingPage,
});
