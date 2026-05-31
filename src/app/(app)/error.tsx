"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// A chunk that 404s after a redeploy (the open tab still points at the old
// build's filenames) throws a ChunkLoadError on client navigation — which is
// exactly the "error window when I click through" symptom. Detect it and do a
// hard reload to pull the fresh build instead of showing a dead end.
function isStaleChunkError(error: Error) {
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk [\d]+ failed/i.test(error.message) ||
    /Failed to fetch dynamically imported module/i.test(error.message) ||
    /importing a module script failed/i.test(error.message)
  );
}

// In production, Server Component errors are intentionally opaque (security:
// stack traces can leak server internals). But for a single-user app where the
// owner IS the operator, that hides EVERY useful clue. We surface message +
// digest (the prod-safe lookup id) so future bugs are diagnosable in-context
// instead of demanding a server log dive. Stack is shown when present (dev).
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isStaleChunkError(error)) {
      window.location.reload();
    }
  }, [error]);

  const [showDetails, setShowDetails] = useState(false);
  const stale = isStaleChunkError(error);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="w-full max-w-xl">
        <div className="display-eyebrow text-muted-foreground">
          {stale ? "Refreshing" : "Something hiccuped"}
        </div>
        <h1 className="display-headline mt-2 text-2xl">
          {stale ? "Loading the latest build" : "This view failed to load"}
        </h1>

        {!stale && (
          <p className="mt-3 text-sm text-muted-foreground">
            The page threw on render. Reload usually clears transient issues;
            the details below stay with you for diagnosing real bugs.
          </p>
        )}

        {/* Error message — always visible, both dev and prod. */}
        {!stale && (
          <div className="mt-5 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Error message
            </div>
            <div className="mt-1.5 break-words font-mono text-sm text-foreground">
              {error.message || "(no message — unusual; share the digest with the maintainer)"}
            </div>
            {error.digest && (
              <>
                <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
                  Digest
                </div>
                <div className="mt-1.5 break-all font-mono text-xs text-muted-foreground">
                  {error.digest}
                </div>
              </>
            )}
          </div>
        )}

        {/* Stack — dev/local builds expose it; click to reveal so it doesn't
            dominate the surface. Empty in prod where stack is stripped. */}
        {!stale && error.stack && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showDetails ? "Hide stack" : "Show stack"}
            </button>
            {showDetails && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-foreground/10 bg-foreground/[0.02] p-3 text-xs leading-relaxed text-muted-foreground">
                {error.stack}
              </pre>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
          <Button onClick={reset} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    </div>
  );
}
