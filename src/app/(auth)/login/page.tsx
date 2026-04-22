"use client";

import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoMark } from "@/components/brand/logo";
import { login } from "./actions";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await login(password);
      if (result?.error) {
        setError(result.error);
        setPassword("");
      }
    });
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background bg-grid px-4">
      <div className="pointer-events-none absolute inset-0 brand-glow-strong" />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.2, 0.9, 0.3, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="glass rounded-3xl border border-border/60 p-8 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)]">
          <div className="mb-8 flex flex-col items-center gap-5">
            <motion.div
              initial={{ rotate: -8, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.1 }}
            >
              <LogoMark className="h-14 w-14 drop-shadow-[0_8px_24px_rgba(157,107,255,0.35)]" />
            </motion.div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Freelane</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your password to unlock.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                autoComplete="current-password"
                className="h-11 pl-9"
                disabled={pending}
              />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-destructive"
              >
                {error}
              </motion.p>
            )}

            <Button
              type="submit"
              className="group h-11 w-full gap-2"
              disabled={pending || !password}
            >
              {pending ? "Unlocking…" : "Unlock"}
              {!pending && (
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          A personal ledger. Locked by you, for you.
        </p>
      </motion.div>
    </div>
  );
}
