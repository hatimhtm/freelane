import "server-only";
import { GoogleGenAI } from "@google/genai";

// Single Gemini client. Key is server-only (GEMINI_API_KEY) — never shipped to
// the browser. Flash is plenty for the small, structured JSON jobs here.
let client: GoogleGenAI | null = null;

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

// Gemini 3.1 Pro Preview — matches the model used in viralos. Note: Gemini 3
// Pro requires thinking mode, so never pass thinkingBudget: 0.
export const MODEL = "gemini-3-pro-preview";
