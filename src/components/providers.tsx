"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      themes={[
        "theme-graphite",
        "theme-midnight",
        "theme-slate",
        "theme-arctic",
        "theme-paper",
        "theme-carbon",
      ]}
      defaultTheme="theme-graphite"
      enableSystem={false}
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
