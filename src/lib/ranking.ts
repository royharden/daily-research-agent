// Frontend mirror of supabase/functions/_shared/ranking.ts + similarity.ts.
import type { Item } from "./types";

export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2);
  const wa = norm(a);
  const wb = norm(b);
  if (!wa.length || !wb.length) return 0;
  const setA = new Set(wa);
  const setB = new Set(wb);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

export const MAX_PER_SOURCE = 2;

export function itemScore(relevance: number, substance: number, skipP: number, novel: boolean): number {
  const base = (relevance / 4) * 0.55 + (substance / 4) * 0.35 + (novel ? 1 : 0) * 0.10;
  return base * (1 - skipP);
}

// token-savings constants (editable)
export const LLM_TOKENS_PER_ITEM = 450; // est. prompt+completion tokens per item if sent to the LLM
export const JEV_TOKENS_PER_ITEM = 90; // est. input tokens per item through Jev
export const LLM_COST_PER_MTOK = 2.5; // USD per 1M tokens (est.)
export const JEV_COST_PER_MTOK = 0.042; // USD per 1M input tokens (pinned)

export function tokenStats(itemsFetched: number, itemsKept: number) {
  const llmOnlyTokens = itemsFetched * LLM_TOKENS_PER_ITEM;
  const actualTokens = itemsFetched * JEV_TOKENS_PER_ITEM + itemsKept * LLM_TOKENS_PER_ITEM;
  const saved = Math.max(0, llmOnlyTokens - actualTokens);
  const llmOnlyCost = (llmOnlyTokens * LLM_COST_PER_MTOK) / 1_000_000;
  const jevCost = (itemsFetched * JEV_TOKENS_PER_ITEM * JEV_COST_PER_MTOK) / 1_000_000;
  return { saved, llmOnlyCost, jevCost };
}
