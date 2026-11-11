import type { MetadataRoute } from "next";

/** Lets ViralKing be installed as an app (iPhone: Add to Home Screen; Mac: Add to Dock / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ViralKing AI",
    short_name: "ViralKing",
    description: "Your own AI video studio for scroll-stopping social ads.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
