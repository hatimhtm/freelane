"use client";

import { motion } from "motion/react";

// Slow-orbiting gradient orbs rendered behind the app shell. Purely decorative,
// sits at very low opacity so it never distracts from content.
export function BackgroundOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        aria-hidden
        className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.72 0.2 285 / 0.18), transparent 70%)",
        }}
        animate={{ x: [0, 60, -20, 0], y: [0, 30, -20, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.74 0.15 200 / 0.14), transparent 70%)",
        }}
        animate={{ x: [0, -40, 20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
