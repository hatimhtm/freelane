import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CHANGELOG.md at the repo root is read at request time by
  // src/lib/changelog/load.ts (via `readFile(join(process.cwd(),
  // 'CHANGELOG.md'))`). Next's static tracer cannot infer the dynamic
  // join target, so we explicitly include the file in the output trace
  // for any route that imports the loader. Without this, the Vercel
  // deploy ships the route handlers WITHOUT the markdown, the loader
  // throws ENOENT, and Settings -> Updates renders empty.
  outputFileTracingIncludes: {
    "/settings/updates": ["./CHANGELOG.md"],
    "/api/changelog.json": ["./CHANGELOG.md"],
    "/api/check-updates": ["./CHANGELOG.md"],
    "/api/cron/check-updates": ["./CHANGELOG.md"],
    "/settings": ["./CHANGELOG.md"],
  },
  // /should-i-buy → / redirect (freelane-shouldibuy-design 2026-06-02).
  // The /should-i-buy route was retired when the workflow moved into the
  // page-aware chatbot (intent-classifier routes "should I buy X?" to the
  // purchase-decision brain, chat-answer narrates the verdict). This config-
  // level redirect lets Next short-circuit legacy bookmarks BEFORE the App
  // Router does any route lookup. The route folder under src/app/(app)/
  // should-i-buy/ is intentionally deleted so the route table is clean.
  async redirects() {
    return [
      {
        source: "/should-i-buy",
        destination: "/",
        permanent: false,
      },
      // What's New moved to Settings → Updates (freelane-whatsnew-design
      // 2026-06-02). The CHANGELOG.md in the repo root is now the single
      // source of truth and Settings → Updates renders the parsed entries.
      // Path-route target (NOT a query string) because the subtab is
      // implemented as a sub-route mirroring /settings/notifications.
      {
        source: "/changelog",
        destination: "/settings/updates",
        permanent: false,
      },
      // The brief literal target was /settings?subtab=updates. The shipped
      // implementation uses the sub-route shape /settings/updates instead,
      // which matches the Settings workflow design memory. This redirect
      // catches any deep links that arrived in the query-string form
      // (older clients, external docs, the macOS companion's What's New
      // menu) and lands them on the canonical sub-route. Without it,
      // /settings?subtab=updates would render the Settings landing
      // without honoring the subtab hint.
      {
        source: "/settings",
        has: [{ type: "query", key: "subtab", value: "updates" }],
        destination: "/settings/updates",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
