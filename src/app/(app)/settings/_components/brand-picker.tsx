"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WALLET_BRANDS, type WalletBrandKey } from "@/lib/brand/wallets";

// Same hex regex the DB CHECK enforces (and the methods-form guard
// re-tests). Mirrored here so the inline swatch never tries to render an
// invalid background like "blue22" — that string is unparseable by the
// browser and the tile glitches visually until the user types a valid
// value.
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Brand picker tiles for Settings → Wallets. Used inside the add/edit
// payment-method dialog. The 6 canonical wallets (seeded in
// wallet_platform_metadata) + an "Auto" tile that clears brand_key so the
// resolver falls back to fuzzy name matching + a "Custom" tile that opens
// a small inline form (glyph + hex colour) for wallets that don't match
// any curated brand.
//
// Selection writes the tile's brand_key to the form state. When the user
// chooses "Custom", brand_key gets the literal value "custom" so
// resolveWalletBrand (extended via 0110) knows to read custom_brand_glyph
// + custom_brand_color off the row.

export type BrandPickerValue = {
  brandKey: WalletBrandKey | null;
  customGlyph: string | null;
  customColor: string | null;
};

export function BrandPicker({
  value,
  onChange,
}: {
  value: BrandPickerValue;
  onChange: (next: BrandPickerValue) => void;
}) {
  const tiles = Object.values(WALLET_BRANDS);
  const autoActive = !value.brandKey;
  const customActive = value.brandKey === "custom";
  // Custom inline form mounts whenever the Custom tile is the active one.
  // Previously we held this in a separate useState that initialised once
  // at mount, so an external write to brand_key (e.g. parent form reset)
  // wouldn't follow. Deriving from the canonical value keeps the form
  // honest without an extra useEffect.
  const customOpen = customActive;

  // Remember the last non-null custom glyph/colour the user typed so
  // toggling Auto → Custom doesn't blow away their previous picks.
  // Lives in a ref because the value is purely cosmetic — it never feeds
  // a render directly, only the next activate("custom") call.
  const lastCustomRef = useRef<{ glyph: string | null; color: string | null }>({
    glyph: value.customGlyph ?? null,
    color: value.customColor ?? null,
  });
  if (value.customGlyph) lastCustomRef.current.glyph = value.customGlyph;
  if (value.customColor) lastCustomRef.current.color = value.customColor;

  function activate(key: WalletBrandKey | null) {
    if (key === "custom") {
      onChange({
        brandKey: "custom",
        // Prefer current state, then the last non-null pick the user
        // made before toggling away, then a neutral default. Without
        // the ref, re-entering Custom always reset colour to "#888888"
        // even if the user had already picked, say, "#ff6600".
        customGlyph:
          value.customGlyph ?? lastCustomRef.current.glyph ?? "",
        customColor:
          value.customColor ?? lastCustomRef.current.color ?? "#888888",
      });
      return;
    }
    onChange({ brandKey: key, customGlyph: null, customColor: null });
  }

  // Only render the inline swatch background when the colour parses.
  // "blue", "#zzz", "#12" etc. would otherwise pass straight through as
  // background:"blue22" / "#zzz22" / "#1222" — all unparseable, so the
  // tile renders with no fill at all during the typing window.
  const safeCustomColor =
    value.customColor && HEX_COLOR_RE.test(value.customColor)
      ? value.customColor
      : null;

  return (
    <div className="space-y-3">
      <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => activate(null)}
          aria-pressed={autoActive}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] transition-colors",
            autoActive
              ? "border-foreground bg-foreground/5 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md border border-dashed border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            A
          </span>
          <span>Auto</span>
        </button>
        {tiles.map((brand) => {
          // tiles come from WALLET_BRANDS — the 6 curated brands. Their
          // brandKey is guaranteed to be one of WalletBrandKey; the union
          // includes "generic" only because buildGenericWalletBrand
          // returns a WalletBrand with brandKey="generic". The cast is
          // safe here.
          const brandKey = brand.brandKey as WalletBrandKey;
          const active = value.brandKey === brandKey;
          const Glyph = brand.Glyph;
          return (
            <button
              key={brandKey}
              type="button"
              onClick={() => activate(brandKey)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] transition-colors",
                active
                  ? "border-foreground bg-foreground/5 text-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
              style={
                brand.color
                  ? { borderColor: active ? brand.color : undefined }
                  : undefined
              }
            >
              <Glyph className="size-7" />
              <span className="truncate">{brand.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => activate("custom")}
          aria-pressed={customActive}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] transition-colors",
            customActive
              ? "border-foreground bg-foreground/5 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
          style={
            customActive && safeCustomColor
              ? { borderColor: safeCustomColor }
              : undefined
          }
        >
          <span
            aria-hidden
            className={cn(
              "grid size-7 place-items-center rounded-md font-semibold",
              // Auto-shrink the type so a 3-4 char glyph still fits the
              // 28px tile. Matches the GenericWalletGlyph runtime sizing.
              (value.customGlyph?.trim().length ?? 0) >= 3
                ? "text-[9px]"
                : "text-[12px]",
            )}
            style={{
              background: safeCustomColor ? `${safeCustomColor}22` : undefined,
              color: safeCustomColor ?? undefined,
            }}
          >
            {value.customGlyph?.trim() || "+"}
          </span>
          <span>Custom</span>
        </button>
      </div>

      {customOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Glyph
            </Label>
            <Input
              maxLength={4}
              placeholder="₿ · X · 🏦"
              value={value.customGlyph ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  brandKey: "custom",
                  customGlyph: e.target.value,
                })
              }
            />
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Up to four characters — the glyph auto-shrinks for 3–4 chars,
              but one or two reads cleanest.
            </p>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.customColor ?? "#888888"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    brandKey: "custom",
                    customColor: e.target.value,
                  })
                }
                className="h-9 w-12 cursor-pointer rounded border border-border/60 bg-transparent"
              />
              <Input
                className="flex-1 font-mono"
                value={value.customColor ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    brandKey: "custom",
                    customColor: e.target.value,
                  })
                }
                placeholder="#888888"
              />
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Hex (#rgb or #rrggbb). Anything else gets rejected by the DB.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
