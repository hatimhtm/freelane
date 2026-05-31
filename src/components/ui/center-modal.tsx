"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type CenterModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Tighter footprint when the form is short. */
  size?: "sm" | "md" | "lg";
  /** Optional className applied to the popup container. */
  className?: string;
  /** Hide the default close button (rare; default true). */
  showCloseButton?: boolean;
  children: React.ReactNode;
};

const SIZE_CLASS: Record<NonNullable<CenterModalProps["size"]>, string> = {
  sm: "sm:max-w-[440px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[600px]",
};

/**
 * Center-screen modal tuned to the dense Freelane redesign:
 *  - 480-560px wide (use `size`)
 *  - 14px radius
 *  - 16-20px padding
 *  - Header / Body / Footer slots, footer is sticky-bottom for forms.
 *
 * Replaces side-sheet patterns for all entry/edit forms.
 */
export function CenterModal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  className,
  showCloseButton = true,
  children,
}: CenterModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="center-modal"
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[min(640px,calc(100dvh-2rem))] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] bg-popover text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            SIZE_CLASS[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-base leading-tight font-medium">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-xs leading-snug text-muted-foreground">
                  {description}
                </DialogDescription>
              )}
            </div>
            {showCloseButton && (
              <DialogClose
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-mt-1 -mr-1.5 shrink-0"
                  />
                }
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogClose>
            )}
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

/**
 * Scrollable body region. Inherits the modal padding and lets long forms
 * scroll independently of the sticky footer.
 */
export function CenterModalBody({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="center-modal-body"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-5 pb-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sticky footer for primary/secondary actions. Hairline top divider, not a
 * filled bar — keeps the form quiet.
 */
export function CenterModalFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="center-modal-footer"
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-t border-foreground/10 bg-popover/95 px-5 py-3 supports-backdrop-filter:bg-popover/80 supports-backdrop-filter:backdrop-blur-md",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
