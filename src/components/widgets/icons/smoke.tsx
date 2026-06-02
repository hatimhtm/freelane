"use client";

import type { SVGProps } from "react";

// Canonical Freelane glyph for cigarettes / pack rhythm.
// Per locked widget system: "Cigarettes → custom smoke SVG (lucide's smoking
// icon is too literal)." Two curling lines + a tiny ember dot — reads as a
// thin smoke curl at glance.
export function Smoke({
  className,
  width = 16,
  height = 16,
  ...rest
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {/* Upper curl */}
      <path d="M14 4c-1.6 1.3-1.6 2.7 0 4s1.6 2.7 0 4" />
      {/* Lower curl */}
      <path d="M9 8c-1.6 1.3-1.6 2.7 0 4s1.6 2.7 0 4" />
      {/* Ember */}
      <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default Smoke;
