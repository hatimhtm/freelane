// Freelane notification types — shared between dispatcher, actions,
// click-routing, and the settings UI. Kept separate from dispatcher.ts so
// client modules can import the types without dragging in `server-only`.

export type NotificationPayload = {
  choices?: string[];
  freeText?: boolean;
  placeholder?: string;
  kind_specific?: Record<string, unknown>;
};

export type NotificationAnswer = string | string[] | null;

export type PerKindPref = {
  in_app?: boolean;
  push?: boolean;
  sound?: boolean;
};

export type PerKindPrefs = Record<string, PerKindPref>;

export type NotificationSettings = {
  retention_days: number;
  retention_forever: boolean;
  push_enabled: boolean;
  per_kind_prefs: PerKindPrefs;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  retention_days: 3,
  retention_forever: false,
  push_enabled: false,
  per_kind_prefs: {},
};

// Single source of truth for per-kind defaults. Consumed by both the
// dispatcher (gating in_app + push) and the per-kind UI table. Keeping the
// fallback in one place stops the UI from silently misrepresenting state
// when the dispatcher default changes.
//
// in_app: true   — quiet inbox by default; users opt OUT per kind.
// push: false    — strict per-kind opt-in. Even after the user enables
//                  Browser push globally, no kind reaches the OS until
//                  it's flipped on here.
// sound: false   — silent by default; opt-in per kind.
export type EffectivePerKindPref = Required<PerKindPref>;

export const DEFAULT_PER_KIND_PREF: EffectivePerKindPref = {
  in_app: true,
  push: false,
  sound: false,
};

// Per-kind default OVERRIDES. The catalogue default (above) gives every
// kind a calm in_app=true / push=false baseline. Some kinds want a
// stronger default (e.g. an AI clarifying question should reach the
// phone) — the override lives HERE so the dispatcher + UI both read the
// same fallback.
//
// NOTE: users who already touched Settings keep whatever they last saved
// (an explicit value in prefs[kind] beats the override). Only new users
// or never-touched kinds inherit these overrides.
export const KIND_DEFAULT_OVERRIDES: Record<string, Partial<EffectivePerKindPref>> = {
  ai_clarifying_question: {
    in_app: true,
    push: true,
  },
};

export function effectivePerKindPref(
  prefs: PerKindPrefs,
  legacy: Record<string, { in_app?: boolean }> | undefined,
  kind: string,
): EffectivePerKindPref {
  const next = prefs[kind] ?? {};
  const legacyKind = legacy?.[kind];
  const override = KIND_DEFAULT_OVERRIDES[kind] ?? {};
  return {
    in_app:
      next.in_app ??
      legacyKind?.in_app ??
      override.in_app ??
      DEFAULT_PER_KIND_PREF.in_app,
    push: next.push ?? override.push ?? DEFAULT_PER_KIND_PREF.push,
    sound: next.sound ?? override.sound ?? DEFAULT_PER_KIND_PREF.sound,
  };
}

// Shared "5m / 2h / 3d / just now" relative-time string for notification
// rows. Used by the bell popover AND the /notifications page so both
// surfaces show the same string per spec.
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
