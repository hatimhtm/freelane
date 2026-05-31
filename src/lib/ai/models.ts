import { GoogleGenAI } from "@google/genai";

// Model registry. Two tiers today, both Gemini; the abstraction exists so the
// fast tier can swap to a local LLM (Ollama / llama.cpp on M3 Pro) later
// without touching every caller.
//
// HEAVY = reasoning, AI overlay, structured generation with thinking on.
// FAST  = autocomplete, tag suggestion, price-typo nudge — cheap & latency-bound.
//
// Flash Lite ID verified via web search 2026-06: `gemini-2.5-flash-lite` is the
// current stable tier (the preview alias gemini-2.5-flash-lite-preview-09-2025
// is being retired 2026-07-09). Override with GEMINI_FAST_MODEL if Google
// ships a newer stable tier mid-build.

let client: GoogleGenAI | null = null;

export const HEAVY_MODEL = "gemini-3.1-pro-preview";

export const FAST_MODEL =
  process.env.GEMINI_FAST_MODEL ?? "gemini-2.5-flash-lite";

export function pickModel(tier: "heavy" | "fast"): string {
  return tier === "heavy" ? HEAVY_MODEL : FAST_MODEL;
}

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}
