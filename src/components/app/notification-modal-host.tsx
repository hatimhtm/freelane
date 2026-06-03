"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Center modal host — one Dialog rendered at the (app)/layout level. Any
// client component can call `openModal(node)` via the hook to surface a
// notification-driven modal without prop-drilling. The host also owns the
// open state; closing the dialog clears the content.
//
// Size hint:
//   - 'default' (sm:max-w-md, ~448px) — short forms, info, multi-choice
//   - 'reader'  (sm:max-w-[720px])   — editorial reading surfaces (letters)
//     so the inner article's mx-auto max-w-[680px] reaches the locked
//     680px reading column.
//
// Chromeless:
//   - When true the DialogHeader (DialogTitle + DialogDescription) is
//     skipped — the modal body owns its own typography. The sr-only
//     fallback Title is still rendered for screen-reader semantics.

export type ModalSize = "default" | "reader";

export type ModalOptions = {
  title?: string;
  description?: string;
  size?: ModalSize;
  chromeless?: boolean;
};

type ModalContextValue = {
  openModal: (node: ReactNode, options?: ModalOptions) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export function useNotificationModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error(
      "useNotificationModal must be used inside <NotificationModalHost>",
    );
  }
  return ctx;
}

export function NotificationModalHost({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [meta, setMeta] = useState<ModalOptions>({});
  const [open, setOpen] = useState(false);

  const openModal = useCallback(
    (node: ReactNode, options?: ModalOptions) => {
      setContent(node);
      setMeta(options ?? {});
      setOpen(true);
    },
    [],
  );

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  const value = useMemo<ModalContextValue>(
    () => ({ openModal, closeModal }),
    [openModal, closeModal],
  );

  const sizeClass =
    meta.size === "reader" ? "sm:max-w-[720px]" : "sm:max-w-md";
  const showHeader =
    !meta.chromeless && (Boolean(meta.title) || Boolean(meta.description));

  return (
    <ModalContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o: boolean) => {
          setOpen(o);
          if (!o) setContent(null);
        }}
      >
        <DialogContent className={cn(sizeClass)}>
          {showHeader && (
            <DialogHeader>
              {meta.title && <DialogTitle>{meta.title}</DialogTitle>}
              {meta.description && (
                <DialogDescription>{meta.description}</DialogDescription>
              )}
            </DialogHeader>
          )}
          {content}
          {/* a11y fallback — every Dialog needs an accessible name. When
              the host renders chromeless (or with no title) we still emit
              a sr-only Title so screen-readers don't read 'unlabelled
              dialog'. */}
          {(!showHeader || !meta.title) && (
            <DialogPrimitive.Title className="sr-only">
              {meta.title ?? "Notification"}
            </DialogPrimitive.Title>
          )}
        </DialogContent>
      </Dialog>
    </ModalContext.Provider>
  );
}
