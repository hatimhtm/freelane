"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
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

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="display-eyebrow text-muted-foreground">Something hiccuped</div>
        <h1 className="display-headline mt-2 text-2xl">This view failed to load</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          It&apos;s usually a fresh deploy still settling in. Try again — a reload
          almost always clears it.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset} variant="outline">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    </div>
  );
}
