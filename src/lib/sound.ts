// A single 12ms tick synthesized via Web Audio — no asset to ship, no network.
// Played on "marked paid" (and other satisfying confirmations). Paired with a
// tiny haptic on devices that support it. Respects a user mute flag in
// localStorage ("freelane.sound" === "off").

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function soundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("freelane.sound") !== "off";
}

export function setSoundEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("freelane.sound", on ? "on" : "off");
}

export function playTick(opts: { haptic?: boolean } = { haptic: true }) {
  if (!soundEnabled()) return;
  const c = audio();
  if (c) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = 920;
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.06);
  }
  if (opts.haptic && typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
  }
}

// A softer two-note "saved" chime for the bigger moment (a payment landing).
export function playLanded() {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c) return;
  [880, 1320].forEach((freq, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t = c.currentTime + i * 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.16);
  });
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate?.([10, 30, 14]); } catch { /* */ }
  }
}
