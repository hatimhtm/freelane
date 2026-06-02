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

// Center modal host — one Dialog rendered at the (app)/layout level. Any
// client component can call `openModal(node)` via the hook to surface a
// notification-driven modal without prop-drilling. The host also owns the
// open state; closing the dialog clears the content.

type ModalContextValue = {
  openModal: (node: ReactNode, options?: { title?: string; description?: string }) => void;
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
  const [meta, setMeta] = useState<{ title?: string; description?: string }>({});
  const [open, setOpen] = useState(false);

  const openModal = useCallback(
    (node: ReactNode, options?: { title?: string; description?: string }) => {
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
        <DialogContent className="sm:max-w-md">
          {(meta.title || meta.description) && (
            <DialogHeader>
              {meta.title && <DialogTitle>{meta.title}</DialogTitle>}
              {meta.description && (
                <DialogDescription>{meta.description}</DialogDescription>
              )}
            </DialogHeader>
          )}
          {content}
          {!meta.title && (
            <DialogPrimitive.Title className="sr-only">
              Notification
            </DialogPrimitive.Title>
          )}
        </DialogContent>
      </Dialog>
    </ModalContext.Provider>
  );
}
