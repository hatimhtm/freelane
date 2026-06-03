import { qiblaBearingTrueNorth, distanceToMeccaKm } from "@/lib/faith/qibla";

// Server-rendered qibla card. We don't read the device compass — we
// render a true-north rose with an arrow at the computed bearing so the
// user can align it against their phone's compass app.

export function QiblaCompass({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const bearing = qiblaBearingTrueNorth(latitude, longitude);
  const distance = distanceToMeccaKm(latitude, longitude);

  if (bearing == null) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
        Add your latitude + longitude below to compute the qibla bearing.
      </div>
    );
  }

  const rounded = Math.round(bearing * 10) / 10;
  const arrowStyle = { transform: `rotate(${bearing}deg)` } as const;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4">
      <div className="relative size-24 shrink-0 rounded-full border border-border/60 bg-muted/30">
        {/* Cardinal labels */}
        <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
          N
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
          S
        </span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
          W
        </span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
          E
        </span>
        {/* Arrow */}
        <div
          className="absolute inset-0 grid place-items-center"
          style={arrowStyle}
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            aria-label={`Qibla bearing ${rounded}° true north`}
          >
            <line
              x1="32"
              y1="48"
              x2="32"
              y2="14"
              stroke="currentColor"
              strokeWidth="2"
              className="text-emerald-600 dark:text-emerald-400"
            />
            <polygon
              points="32,8 27,18 37,18"
              className="fill-emerald-600 dark:fill-emerald-400"
            />
          </svg>
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Qibla
        </div>
        <div className="text-2xl font-semibold tabular">{rounded}°</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          true north
          {distance != null && (
            <> · {Math.round(distance).toLocaleString()} km to Mecca</>
          )}
        </div>
        <div className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
          Phone compasses read magnetic north; in PH the offset from true
          north is about 1°.
        </div>
      </div>
    </div>
  );
}
