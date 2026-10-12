// run-skill: fetch sources -> dedupe -> Jev (batched) -> rank -> call write-digest.
// verify_jwt = true — callers must send the anon key (frontend via supabase.functions.invoke, cron via Authorization header).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  json,
  DAILY_LIMIT_BODY,
  HttpError,
  SafeError,
  UUID_RE,
  MAX_RESPONSE_BYTES,
  truncate,
  sanitizeUntrusted,
  safeFetch,
  checkUrl,
  isHttpUrl,
  readJsonBody,
  readTextBounded,
  nowIso,
} from "../_shared/deno-utils.ts";
import { serviceClient, tryIncrementUsage } from "../_shared/usage.ts";
import { boundConfigForRun, type SkillSource } from "../_shared/skill-config.ts";
import { dedupeItems } from "../_shared/similarity.ts";
import { rankAndKeep, type JevAnswers, type RankItem } from "../_shared/ranking.ts";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-1.13.0";
const JEV_COST_PER_MTOK = 0.042; // USD per 1M input tokens
const JEV_MAX_ATTEMPTS = 2; // first try + one retry (429 / 529 / network error only)
const JEV_TIMEOUT_MS = 30_000;
const MAX_ITEMS = 60;
const BATCH = 10;
const MAX_BODY_BYTES = 4 * 1024;
const MAX_OUTBOUND_FETCHES = 20; // per run: sources + RSS item-page fallbacks
const DIGEST_MAX_ITEMS = 12; // write-digest rejects more

// ---------- source fetching ----------

interface RawItem {
  url: string;
  title: string;
  summary: string;
  source: string; // e.g. "hn", "rss", "arxiv" (per-source label like "rss:<host>" allowed)
}

/** Per-run cap on outbound fetches. Sources are reserved up front so RSS fallbacks can't starve them. */
class FetchBudget {
  constructor(private remaining: number, private pendingSources: number) {}
  takeSource(): boolean {
    this.pendingSources = Math.max(0, this.pendingSources - 1);
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }
  takeFallback(): boolean {
    if (this.remaining - this.pendingSources <= 0) return false;
    this.remaining--;
    return true;
  }
}

async function fetchSource(src: SkillSource, budget: FetchBudget): Promise<RawItem[]> {
  const type = src.type;
  if (!budget.takeSource()) throw new SafeError(`outbound fetch limit reached (${MAX_OUTBOUND_FETCHES} per run)`);
  if (type === "hn") {
    const query = src.query ?? "";
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`;
    const blocked = checkUrl(url);
    if (blocked) throw new SafeError(`blocked source: ${blocked}`);
    const res = await safeFetch(url);
    if (!res.ok) throw new SafeError(`hn search failed (${res.status})`);
    const data = (await res.json()) as { hits?: Record<string, unknown>[] } | null;
    return (Array.isArray(data?.hits) ? data.hits : [])
      .filter((h: Record<string, unknown>) => h && h.title)
      .map((h: Record<string, unknown>) => ({
        url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
        title: String(h.title),
        summary: sanitizeUntrusted(
          truncate(String(h.story_text || h.comment_text || ""), 400) || `HN story on "${query}"`
        ),
        source: "hn",
      }));
  }
  if (type === "arxiv") {
    const query = src.query ?? "";
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=30`;
    const blocked = checkUrl(url);
    if (blocked) throw new SafeError(`blocked source: ${blocked}`);
    const res = await safeFetch(url);
    if (!res.ok) throw new SafeError(`arxiv fetch failed (${res.status})`);
    const xml = await res.text();
    const items: RawItem[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) && items.length < 30) {
      const entry = m[1];
      const pick = (tag: string) => {
        const t = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry);
        return t ? t[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      };
      const link = /<id>(http[^<]+)<\/id>/.exec(entry)?.[1] ?? "";
      const title = pick("title");
      if (!title || !link) continue;
      items.push({
        url: link,
        title,
        summary: sanitizeUntrusted(truncate(pick("summary"), 400)),
        source: "arxiv",
      });
    }
    return items;
  }
  if (type === "rss") {
    const feedUrl = src.url ?? "";
    const res = await safeFetch(feedUrl);
    if (!res.ok) throw new SafeError(`rss fetch failed (${res.status})`);
    const xml = await res.text();
    const items: RawItem[] = [];
    // RSS <item> and Atom <entry>
    const entryRe = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) && items.length < 30) {
      const entry = m[1];
      const pick = (tag: string) => {
        const t = new RegExp(`<(?:${tag})[^>]*>([\\s\\S]*?)</(?:${tag})>`).exec(entry);
        return t ? t[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      };
      const title = pick("title");
      let link = pick("link");
      if (!link) {
        const href = /<link[^>]*href="([^"]+)"/.exec(entry)?.[1];
        if (href) link = href;
      }
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
      let summary = pick("description") || pick("summary") || pick("content");
      // polite fallback: fetch the item page title only, within the per-run fetch budget
      if (!summary && budget.takeFallback()) {
        try {
          const page = await safeFetch(link, { timeoutMs: 10_000, maxBytes: 64 * 1024, truncate: true });
          const html = (await page.text()).slice(0, 20_000);
          const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
          if (t) summary = truncate(t.replace(/<[^>]+>/g, "").trim(), 200);
        } catch {
          /* skip */
        }
      }
      items.push({ url: link, title, summary: sanitizeUntrusted(truncate(summary, 400)), source: "rss" });
    }
    return items;
  }
  if (type === "reddit") {
    const url0 = src.url ?? "";
    const res = await safeFetch(url0.endsWith(".json") ? url0 : url0.replace(/\/$/, "") + "/.json?limit=30");
    if (!res.ok) throw new SafeError(`reddit fetch failed (${res.status})`);
    const data = (await res.json()) as { data?: { children?: Record<string, unknown>[] } } | null;
    const children = Array.isArray(data?.data?.children) ? data.data.children : [];
    return children
      .map((c: Record<string, unknown>) => {
        const d = (c?.data ?? {}) as Record<string, unknown>;
        return {
          url: String(d.url || `https://reddit.com${d.permalink}`),
          title: String(d.title ?? ""),
          summary: sanitizeUntrusted(truncate(String(d.selftext || ""), 400)),
          source: "reddit",
        };
      })
      .filter((i: RawItem) => i.title && i.url);
  }
  throw new SafeError(`unknown source type: ${String(type).slice(0, 20)}`);
}

// ---------- Jev ----------

interface JevPayload {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

function buildBatchPayload(
  batch: RankItem[],
  caresAbout: string,
  skip: string
): JevPayload {
  const itemsState: Record<string, unknown> = {};
  const questions: Record<string, unknown> = {};
  batch.forEach((it, idx) => {
    const id = `item${idx + 1}`;
    itemsState[id] = {
      title: truncate(it.title, 120),
      source: it.source,
      summary: truncate(it.summary, 400),
    };
    for (const q of ["relevance", "skip", "substance", "kind"]) {
      const qid = `${id}__${q}`;
      if (q === "relevance") {
        questions[qid] = {
          type: "score",
          instructions: `How well does \`items.${id}\` match \`skill.cares_about\`?`,
          criteria: ["Not relevant.", "Barely relevant.", "Somewhat relevant.", "Relevant.", "Exactly what the reader wants."],
        };
      } else if (q === "skip") {
        questions[qid] = {
          type: "noul",
          instructions: `Does \`items.${id}\` fall under \`skill.skip\`?`,
          criteria: { true: "It's something the reader wants skipped.", false: "It isn't." },
        };
      } else if (q === "substance") {
        questions[qid] = {
          type: "score",
          instructions: `How substantive is \`items.${id}\`, judging from its title and summary?`,
          criteria: ["Clickbait or empty.", "Thin.", "Average.", "Solid.", "Deep and original."],
        };
      } else {
        questions[qid] = {
          type: "choice",
          instructions: `What kind of item is \`items.${id}\`?`,
          criteria: {
            research: "Paper or research result.",
            release: "Product or library release.",
            tutorial: "How-to or guide.",
            opinion: "Opinion or essay.",
            news: "News or announcement.",
            discussion: "Forum discussion.",
            uncertain: "Can't tell.",
          },
        };
      }
    }
  });
  return {
    model: JEV_MODEL,
    state: { skill: { cares_about: caresAbout, skip }, items: itemsState },
    questions,
  };
}

interface JevRawResult {
  type: string;
  score?: number;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Jev request. Every fetch (including the retry) is counted against the daily
 * cap right before it goes out; over the cap or a counter failure throws and no
 * further Jev calls are made. Retries only on 429 / 529 / network errors, max 2 attempts.
 */
async function callJev(db: SupabaseClient, payload: JevPayload): Promise<{ answers: Record<string, JevRawResult>; usage: { input_tokens: number; output_tokens: number }; model: string; latency_ms: number }> {
  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) throw new SafeError("TYPESAFE_API_KEY not configured");
  const started = Date.now();
  let lastErr = "";
  for (let attempt = 0; attempt < JEV_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, attempt - 1));
    const usage = await tryIncrementUsage(db, "run-skill-jev");
    if ("over_cap" in usage) throw new SafeError("daily limit reached");
    if ("error" in usage) throw new SafeError("usage counter unavailable");
    let res: Response;
    try {
      res = await fetch(JEV_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
      });
    } catch (e) {
      console.error("Jev network error", (e as Error).message);
      lastErr = "network error";
      continue;
    }
    if (res.status === 429 || res.status === 529) {
      await res.body?.cancel().catch(() => {});
      lastErr = `HTTP ${res.status}`;
      continue;
    }
    if (!res.ok) {
      const detail = await readTextBounded(res, 2048, true).catch(() => "");
      console.error("Jev HTTP error", res.status, detail);
      throw new SafeError(`HTTP ${res.status}`);
    }
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readTextBounded(res, MAX_RESPONSE_BYTES));
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      data = parsed as Record<string, unknown>;
    } catch (e) {
      console.error("Jev invalid response", (e as Error).message);
      throw new SafeError("invalid response");
    }
    const answers = (data.answers && typeof data.answers === "object" ? data.answers : data) as Record<string, JevRawResult>;
    const u = (data.usage ?? {}) as Record<string, unknown>;
    return {
      answers,
      usage: { input_tokens: Number(u.input_tokens) || 0, output_tokens: Number(u.output_tokens) || 0 },
      model: typeof data.model === "string" ? data.model.slice(0, 64) : JEV_MODEL,
      latency_ms: Date.now() - started,
    };
  }
  throw new SafeError(`failed after retries (${lastErr})`);
}

// ---------- handler ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const db = serviceClient();
    if (!db) return json({ error: "Service not configured" }, 503);

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const skill_id = body.skill_id;
    if (!skill_id) return json({ error: "skill_id required" }, 400);
    if (typeof skill_id !== "string" || !UUID_RE.test(skill_id)) return json({ error: "skill_id must be a uuid" }, 400);

    // daily cap check before any work — fail closed on error, 429 on over-cap
    const usage = await tryIncrementUsage(db, "run-skill");
    if ("error" in usage) {
      return json({ error: "Usage counter unavailable — cannot proceed safely" }, 503);
    }
    if ("over_cap" in usage) {
      return json(DAILY_LIMIT_BODY, 429);
    }

    const runStart = Date.now();

    const { data: skill, error: skillErr } = await db.from("skills").select("*").eq("id", skill_id).maybeSingle();
    if (skillErr || !skill) return json({ error: "skill not found" }, 404);

    // config is user-authored: re-bound everything read from the DB
    const config = boundConfigForRun(skill.config);
    const { sources, keep, cares_about: caresAbout, skip } = config;

    // create run row
    const { data: run, error: runErr } = await db
      .from("runs")
      .insert({ skill_id: skill.id, status: "running", counts: {} })
      .select()
      .maybeSingle();
    if (runErr || !run) return json({ error: "could not create run" }, 500);

    const finish = async (status: string, counts: Record<string, number>, cost: number, error: string | null) => {
      await db
        .from("runs")
        .update({
          status,
          counts,
          jev_cost_usd: cost,
          latency_ms: Date.now() - runStart,
          error,
          finished_at: nowIso(),
        })
        .eq("id", run.id);
    };

    try {
      // 1. fetch
      const raw: RawItem[] = [];
      const fetchErrors: string[] = config.rejected.map((r) => `rejected source: ${r}`);
      const budget = new FetchBudget(MAX_OUTBOUND_FETCHES, sources.length);
      for (const src of sources) {
        try {
          const items = await fetchSource(src, budget);
          raw.push(...items.filter((it) => isHttpUrl(it.url)));
        } catch (e) {
          if (!(e instanceof SafeError)) console.error("source fetch error", src.type, (e as Error).message);
          fetchErrors.push(`${src.type}: ${e instanceof SafeError ? e.message : "fetch failed"}`);
        }
      }
      const fetched = raw.slice(0, MAX_ITEMS);

      // 2. dedupe + novelty prefilter (14 days)
      const { kept: deduped, dropped: dupesDropped } = dedupeItems(fetched);

      const since14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data: seenItems } = await db
        .from("items")
        .select("url")
        .eq("skill_id", skill.id)
        .gte("created_at", since14)
        .limit(2000);
      const seenUrls = new Set((seenItems ?? []).map((r: { url: string }) => r.url));
      const fresh = deduped.filter((it) => !seenUrls.has(it.url));

      // recent kept titles (7 days) for novelty bonus
      const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: recentKept } = await db
        .from("items")
        .select("title")
        .eq("skill_id", skill.id)
        .eq("kept", true)
        .gte("created_at", since7)
        .limit(500);
      const recentTitles = (recentKept ?? []).map((r: { title: string }) => r.title);

      // 3. Jev in batches of 10 — each Jev fetch is counted; on cap/error the rest use the keyword fallback
      const answers = new Map<string, JevAnswers>();
      let totalInputTokens = 0;
      let jevModel = JEV_MODEL;
      let jevLatency = 0;
      let jevError: string | null = null;
      if (fresh.length > 0) {
        try {
          for (let i = 0; i < fresh.length; i += BATCH) {
            const batch = fresh.slice(i, i + BATCH);
            const payload = buildBatchPayload(batch, caresAbout, skip);
            const { answers: rawAnswers, usage, model, latency_ms } = await callJev(db, payload);
            totalInputTokens += usage.input_tokens;
            jevModel = model;
            jevLatency = Math.max(jevLatency, latency_ms);
            batch.forEach((it, idx) => {
              const id = `item${idx + 1}`;
              const rel = rawAnswers[`${id}__relevance`];
              const sk = rawAnswers[`${id}__skip`];
              const sub = rawAnswers[`${id}__substance`];
              const kd = rawAnswers[`${id}__kind`];
              let skipP = 0.0;
              if (sk && typeof sk.noul === "number") skipP = sk.noul;
              else if (sk && sk.probabilities && sk.probabilities.true != null) skipP = sk.probabilities.true;
              answers.set(it.url, {
                relevance: rel && typeof rel.score === "number" ? rel.score : 0,
                substance: sub && typeof sub.score === "number" ? sub.score : 0,
                skip_p: skipP,
                kind: kd && typeof kd.choice === "string" ? kd.choice.slice(0, 40) : "uncertain",
                jev: true,
              });
            });
          }
        } catch (e) {
          // keyword fallback, labeled
          if (!(e instanceof SafeError)) console.error("Jev step error", (e as Error).message);
          jevError = `Jev unreachable: ${e instanceof SafeError ? e.message : "unexpected error"}. Used fallback.`;
          for (const it of fresh) {
            if (!answers.has(it.url)) {
              const fb = keywordFallbackLocal(it, caresAbout, skip);
              answers.set(it.url, fb);
            }
          }
        }
      }

      const jevCost = (totalInputTokens * JEV_COST_PER_MTOK) / 1_000_000;

      // 4. rank & keep
      const candidates = rankAndKeep(fresh, answers, keep, { recentTitles, recentUrls: [] });

      // persist all items
      if (candidates.length > 0) {
        await db.from("items").insert(
          candidates.map((c) => ({
            run_id: run.id,
            skill_id: skill.id,
            url: c.item.url.slice(0, 2048),
            title: c.item.title.slice(0, 500),
            source: c.item.source,
            summary: c.item.summary.slice(0, 2000),
            jev_response: {
              relevance: c.answers.relevance,
              substance: c.answers.substance,
              skip_p: c.answers.skip_p,
              kind: c.answers.kind,
              scored_by: c.answers.jev ? jevModel : "fallback",
            },
            relevance: c.answers.relevance,
            substance: c.answers.substance,
            skip_p: c.answers.skip_p,
            kind: c.answers.kind,
            score: c.score,
            kept: c.kept,
            drop_reason: c.drop_reason,
          }))
        );
      }

      const keptItems = candidates.filter((c) => c.kept);

      // write-digest accepts at most 12 items: keep the 12 best-scored, in their original order
      let digestItems = keptItems;
      if (digestItems.length > DIGEST_MAX_ITEMS) {
        const top = new Set([...digestItems].sort((a, b) => b.score - a.score).slice(0, DIGEST_MAX_ITEMS));
        digestItems = digestItems.filter((c) => top.has(c));
      }

      // 5. digest
      let digestSlug: string | null = null;
      if (digestItems.length > 0) {
        const digestRes = await db.functions.invoke("write-digest", {
          body: {
            run_id: run.id,
            skill_id: skill.id,
            skill_name: truncate(String(skill.name ?? ""), 120),
            output_instructions: config.output,
            items: digestItems.map((c) => ({
              title: truncate(c.item.title, 160),
              url: c.item.url,
              source: c.item.source.slice(0, 40),
              summary: truncate(c.item.summary, 400),
              kind: String(c.answers.kind ?? "").slice(0, 40),
            })),
          },
        });
        if (digestRes.error) {
          await finish("error", countsObj(fetched.length, dupesDropped, fresh.length, keptItems.length), jevCost, `digest: ${digestRes.error.message}`);
          return json({ error: "digest step failed", run_id: run.id }, 500);
        }
        const digestData = digestRes.data as { slug?: string; error?: string };
        if (digestData?.slug) digestSlug = digestData.slug;
      }

      const counts = countsObj(fetched.length, dupesDropped, fresh.length, keptItems.length);
      const finalStatus = jevError ? "success" : "success";
      await finish(finalStatus, counts, jevCost, jevError);

      return json({
        run_id: run.id,
        digest_slug: digestSlug,
        counts,
        jev_cost_usd: jevCost,
        jev_model: jevModel,
        jev_latency_ms: jevLatency,
        fetch_errors: fetchErrors,
      });
    } catch (e) {
      console.error("run-skill pipeline error", (e as Error).message);
      await finish("error", {}, 0, "Run failed");
      return json({ error: "Run failed", run_id: run.id }, 500);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("run-skill error", (err as Error).message);
    return json({ error: "Internal error" }, 500);
  }
});

function countsObj(fetched: number, dupes: number, sent: number, kept: number) {
  return { fetched, deduped: fetched - dupes, sent_to_jev: sent, kept };
}

// keyword fallback used when Jev is unreachable (mirrors _shared/ranking.ts)
function keywordFallbackLocal(item: RankItem, caresAbout: string, skip: string): JevAnswers {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const careWords = new Set(words(caresAbout));
  const skipWords = new Set(words(skip));
  const all = words(text);
  let care = 0;
  let skipHits = 0;
  for (const w of all) {
    if (careWords.has(w)) care++;
    if (skipWords.has(w)) skipHits++;
  }
  return {
    relevance: Math.min(5, 1 + care),
    substance: Math.min(5, 2 + Math.floor(all.length / 40)),
    skip_p: skipHits > 0 && skipHits >= care ? 0.8 : 0.1,
    kind: /paper|benchmark|arxiv|eval/i.test(text) ? "research" : "news",
    jev: false,
  };
}
