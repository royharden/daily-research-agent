// Title similarity + dedupe helpers, shared by ranking and run-skill.
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

export interface DedupItem {
  url: string;
  title: string;
}

export function dedupeItems<T extends DedupItem>(items: T[]): { kept: T[]; dropped: number } {
  const seenUrls = new Set<string>();
  const seenTitles: string[] = [];
  const out: T[] = [];
  let dropped = 0;
  for (const it of items) {
    const urlKey = it.url.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seenUrls.has(urlKey)) {
      dropped++;
      continue;
    }
    if (seenTitles.some((t) => titleSimilarity(t, it.title) > 0.8)) {
      dropped++;
      continue;
    }
    seenUrls.add(urlKey);
    seenTitles.push(it.title);
    out.push(it);
  }
  return { kept: out, dropped };
}
