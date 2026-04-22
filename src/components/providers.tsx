"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>
        {children}
        <Toaster
          position="bottom-right"
          richColors
          theme="system"
          toastOptions={{
            classNames: {
              toast: "glass border border-border/60 !shadow-2xl",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
