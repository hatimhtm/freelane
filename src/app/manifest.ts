import type { MetadataRoute } from "next";

// Web app manifest — lets users "Add to Dock" / install Freelane as a PWA.
// Next.js App Router serves this at /manifest.webmanifest and auto-links it
// from the document head. Colors track the app's dark default.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Freelane",
    short_name: "Freelane",
    description:
      "Every peso you earn — landed, pending, and where the fees went.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#11100c",
    theme_color: "#15140f",
    icons: [
      // SVG mark — scalable; covers any/maskable for crisp dock rendering.
      // Next serves these from app/icon.svg and app/apple-icon.svg.
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/apple-icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
    ],
  };
}
