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
      // Raster PNGs — Chrome's install prompt and the OS dock ignore SVG
      // "any" icons and fall back to a generic glyph, so ship real 192/512
      // PNGs (+ a full-bleed maskable for adaptive/round masks).
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
      // SVG kept as a scalable extra for browsers that prefer it.
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
    ],
  };
}
