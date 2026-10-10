// Pure-TS ranking logic for the run-skill edge function.
// Mirrors src/lib/ranking.ts on the frontend — keep formulas in sync.
import { titleSimilarity } from "./similarity.ts";

export interface RankItem {
  url: string;
  title: string;
  source: string;
  summary: string;
}

export interface JevAnswers {
  relevance: number; // 1..5, 0 if missing
  substance: number; // 1..5, 0 if missing
  skip_p: number; // 0..1
  kind: string;
  jev: boolean; // true when scored by Jev, false for keyword fallback
}

export interface KeepContext {
  recentTitles: string[]; // kept in the last 7 days (novelty)
  recentUrls: string[]; // seen in the last 14 days (prefilter)
}

export interface Candidate {
  item: RankItem;
  answers: JevAnswers;
  score: number;
  kept: boolean;
  drop_reason: string | null;
}

export const MAX_PER_SOURCE = 2;

export function itemScore(a: JevAnswers, novel: boolean): number {
  const base = (a.relevance / 4) * 0.55 + (a.substance / 4) * 0.35 + (novel ? 1 : 0) * 0.10;
  return base * (1 - a.skip_p);
}

export function rankAndKeep(items: RankItem[], answers: Map<string, JevAnswers>, keep: number, ctx: KeepContext): Candidate[] {
  const out: Candidate[] = [];
  const keptTitlesRecent = [...ctx.recentTitles];
  const perSource = new Map<string, number>();

  for (const it of items) {
    const a = answers.get(it.url);
    if (!a) {
      out.push({ item: it, answers: a as unknown as JevAnswers, score: 0, kept: false, drop_reason: "no answer" });
      continue;
    }
    if (ctx.recentUrls.includes(it.url)) {
      out.push({ item: it, answers: a, score: 0, kept: false, drop_reason: "seen in the last 14 days" });
      continue;
    }
    const novel = !keptTitlesRecent.some((t) => titleSimilarity(t, it.title) > 0.6);
    out.push({ item: it, answers: a, score: itemScore(a, novel), kept: false, drop_reason: null });
  }

  const eligible = out.filter((c) => !c.drop_reason).sort((x, y) => y.score - x.score);
  const anyResearchHigh = eligible.some((c) => c.answers.kind === "research" && c.score >= 0.6);

  const kept: Candidate[] = [];
  for (const c of eligible) {
    if (kept.length >= keep) break;
    const srcCount = perSource.get(c.item.source) ?? 0;
    if (srcCount >= MAX_PER_SOURCE) {
      c.drop_reason = `source cap (max ${MAX_PER_SOURCE} per source)`;
      continue;
    }
    perSource.set(c.item.source, srcCount + 1);
    keptTitlesRecent.push(c.item.title);
    c.kept = true;
    kept.push(c);
  }

  // at least 1 research item if any scored >= 0.6
  if (anyResearchHigh && !kept.some((c) => c.answers.kind === "research")) {
    const bestResearch = eligible.find((c) => !c.kept && !c.drop_reason && c.answers.kind === "research" && c.score >= 0.6);
    if (bestResearch && kept.length > 0) {
      const last = kept[kept.length - 1];
      last.kept = false;
      last.drop_reason = "swapped out to keep a research item";
      bestResearch.kept = true;
      bestResearch.drop_reason = null;
      kept[kept.length - 1] = bestResearch;
    }
  }

  for (const c of out) {
    if (!c.kept && !c.drop_reason) c.drop_reason = "outside top keep";
  }

  return out;
}
