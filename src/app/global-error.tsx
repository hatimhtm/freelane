"use client";

import { useEffect } from "react";

// Last-resort boundary: catches errors thrown in the root layout itself.
// Must render its own <html>/<body>. Auto-reloads on a stale-chunk error so a
// post-deploy navigation never strands the user.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (
      error.name === "ChunkLoadError" ||
      /Loading chunk [\d]+ failed/i.test(error.message) ||
      /dynamically imported module/i.test(error.message)
    ) {
      window.location.reload();
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#15140f",
          color: "#faf8f3",
        }}
      >
        <div style={{ maxWidth: 380, textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Freelane hit a snag</h1>
          <p style={{ opacity: 0.7, fontSize: 14, marginTop: 12 }}>
            Reloading usually clears it.
          </p>
          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#faf8f3",
                color: "#15140f",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
