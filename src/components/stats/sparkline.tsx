"use client";

import { useEffect, useRef, useState } from "react";

// Catmull-Rom → cubic-bezier so the line reads soft and hand-drawn rather than
// straight ruler segments. Tension keeps it gentle without overshooting wildly.
function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length < 2) return "";
  const t = 0.32;
  const d = [`M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d.push(
      `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`,
    );
  }
  return d.join(" ");
}

// SVG sparkline that draws its line in when it scrolls into view (once).
// The path uses the .spark-path utility; we set --len to its measured length
// so the dash animation runs the right distance.
export function Sparkline({
  data,
  width = 220,
  height = 44,
  color = "var(--chart-1)",
  filled = false,
  strokeWidth = 2,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  filled?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const p = pathRef.current;
    if (p) p.style.setProperty("--len", String(Math.ceil(p.getTotalLength())));
  }, [data]);

  if (data.length < 2) {
    return <div ref={wrapRef} className={className} style={{ height }} />;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = strokeWidth + 1;
  const usable = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usable - ((v - min) / range) * usable;
    return [x, y] as const;
  });

  const line = smoothPath(points);
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <div ref={wrapRef} className={className}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
        {filled && (
          <>
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#spark-fill)" opacity={inView ? 1 : 0} style={{ transition: "opacity 0.6s ease 0.3s" }} />
          </>
        )}
        <path
          ref={pathRef}
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`spark-path${inView ? " is-in" : ""}`}
        />
      </svg>
    </div>
  );
}
