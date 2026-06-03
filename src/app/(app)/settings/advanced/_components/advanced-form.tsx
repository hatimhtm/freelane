"use client";

// Placeholder home for power-user toggles. Feature flags + dev-mode
// switches slot in as they ship — the page exists so the 12-subtab hub
// has a real destination for each tile and the URL surface stays stable.

export function AdvancedForm() {
  return (
    <div className="space-y-2">
      <p className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-3 text-[12px] leading-snug text-muted-foreground">
        Nothing to flip yet. Feature flags + dev-mode toggles will surface
        here as they ship.
      </p>
    </div>
  );
}
