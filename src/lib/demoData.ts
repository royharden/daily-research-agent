// Recorded runs for Offline replay: fetched items, Jev responses, digest —
// one per example skill. The real ranking code runs on these items in the
// browser; no API calls are made.
import type { DigestContent, Item } from "./types";
import { titleSimilarity } from "./ranking";

export interface DemoRun {
  skillSlug: string;
  fetchedCount: number;
  dedupedCount: number;
  jevCount: number;
  items: Item[];
  digest: DigestContent;
}

function mkItem(
  i: number,
  runId: string,
  skillId: string,
  url: string,
  title: string,
  source: string,
  summary: string,
  relevance: number,
  substance: number,
  skipP: number,
  kind: string,
  kept: boolean,
  dropReason: string | null
): Item {
  return {
    id: `demo-${i}`,
    run_id: runId,
    skill_id: skillId,
    url,
    title,
    source,
    summary,
    jev_response: { relevance, substance, skip_p: skipP, kind, scored_by: "jev-1.13.0" },
    relevance,
    substance,
    skip_p: skipP,
    kind,
    score: null,
    kept,
    drop_reason: dropReason,
    created_at: new Date().toISOString(),
  };
}

const now = Date.now();

// ---------- AI agents digest ----------

const agentsItems: Item[] = [
  mkItem(1, "demo-run-agents", "demo-skill-agents",
    "https://github.com/someorg/agentgraph/releases/tag/v2.0",
    "AgentGraph 2.0: durable state machines for multi-agent workflows",
    "rss",
    "Release adds checkpointed agent state, retry policies per node, and a visual tracer. Benchmarks show 40% fewer failed runs on long-horizon tasks compared to 1.x.",
    5, 4, 0.05, "release", true, null),
  mkItem(2, "demo-run-agents", "demo-skill-agents",
    "https://arxiv.org/abs/2609.12345",
    "Beyond Vibe Evals: contamination-aware benchmarking of tool-using agents",
    "arxiv",
    "Proposes a held-out tool mutation protocol to detect benchmark contamination in agent evals. Finds 23% of popular agent benchmarks leak solutions into training corpora.",
    5, 5, 0.02, "research", true, null),
  mkItem(3, "demo-run-agents", "demo-skill-agents",
    "https://news.ycombinator.com/item?id=39111222",
    "We ran 12k agent runs in production — here is our incident postmortem",
    "hn",
    "A team describes how agent loops spiraled on ambiguous user input, the guardrails they added (budget caps, step limits), and what they would design differently.",
    5, 5, 0.03, "discussion", true, null),
  mkItem(4, "demo-run-agents", "demo-skill-agents",
    "https://news.ycombinator.com/item?id=39108877",
    "Show HN: I built an eval harness for customer-support agents",
    "hn",
    "Open-source harness replays historical tickets against agent changes and diffs resolution rates. Supports LLM-as-judge with calibration against human labels.",
    4, 4, 0.08, "release", true, null),
  mkItem(5, "demo-run-agents", "demo-skill-agents",
    "https://example-blog.dev/why-your-agent-needs-a-logout",
    "Why your agent needs a logout button",
    "rss",
    "Opinion piece arguing agents that act on behalf of users need explicit session boundaries. Light on experiments.",
    2, 2, 0.45, "opinion", false, "low relevance to skill's cares_about"),
  mkItem(6, "demo-run-agents", "demo-skill-agents",
    "https://startupwire.example/seed-round-agent-ai",
    "Agentify raises $18M seed to build agents for agents",
    "hn",
    "Funding announcement. Round led by a large VC; product details are thin.",
    1, 1, 0.9, "news", false, "matches skill.skip (funding announcement)"),
  mkItem(7, "demo-run-agents", "demo-skill-agents",
    "https://arxiv.org/abs/2609.22222",
    "A taxonomy of failure modes in long-horizon LLM agents",
    "arxiv",
    "Manual analysis of 800 agent trajectories identifies 12 recurring failure modes; proposes evals targeting each. Strong error analysis appendix.",
    5, 5, 0.04, "research", false, "outside top keep (already 2 research-quality picks ranked higher)"),
  mkItem(8, "demo-run-agents", "demo-skill-agents",
    "https://news.ycombinator.com/item?id=39107777",
    "AgentGraph 2.0 released with durable state machines",
    "hn",
    "Discussion thread about the same AgentGraph release — duplicate coverage of item 1.",
    4, 3, 0.06, "discussion", false, "duplicate of a higher-ranked title"),
];

// ---------- Indie hacker news ----------

const indieItems: Item[] = [
  mkItem(1, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39120101",
    "I quit my job 8 months ago. My side project now pays the mortgage",
    "hn",
    "Founder shares revenue chart from 0 to $6.2k MRR for a niche B2B chrome extension, plus churn numbers and what marketing channels actually worked.",
    5, 5, 0.02, "discussion", true, null),
  mkItem(2, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39119844",
    "Postmortem: my SaaS died at $900 MRR",
    "hn",
    "Honest writeup: pricing mistakes, single-channel dependence, and the support load that killed motivation. Great lessons for solo founders.",
    5, 5, 0.03, "opinion", true, null),
  mkItem(3, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39117555",
    "Launch today: my tiny tool turns git logs into changelogs",
    "hn",
    "Launch thread with live feedback from early users. Free tier + $5/mo pro.",
    4, 3, 0.05, "release", true, null),
  mkItem(4, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39116001",
    "Sequoia leads $40M round for AI-ified spreadsheet startup",
    "hn",
    "VC funding round, corporate PR tone.",
    1, 1, 0.92, "news", false, "matches skill.skip (VC funding round)"),
  mkItem(5, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39115555",
    "5 habits of wildly successful entrepreneurs (number 3 will surprise you)",
    "hn",
    "Listicle without substance.",
    1, 1, 0.88, "news", false, "matches skill.skip (motivational fluff)"),
  mkItem(6, "demo-run-indie", "demo-skill-indie",
    "https://news.ycombinator.com/item?id=39114222",
    "How I validated 3 ideas in 30 days using landing pages only",
    "hn",
    "Runs through validation experiments with real conversion numbers and costs per test.",
    4, 4, 0.07, "tutorial", false, "outside top keep"),
];

// ---------- LLM evals arXiv ----------

const evalsItems: Item[] = [
  mkItem(1, "demo-run-evals", "demo-skill-evals",
    "https://arxiv.org/abs/2609.30101",
    "CheckMate-Bench: detecting training-set contamination via canary strings",
    "arxiv",
    "Plants cryptographic canaries in synthetic training corpora and measures recovery rates across 9 models. Introduces a contamination score with error bars.",
    5, 5, 0.02, "research", true, null),
  mkItem(2, "demo-run-evals", "demo-skill-evals",
    "https://arxiv.org/abs/2609.29877",
    "Why your benchmark saturates: measurement noise vs. real capability gains",
    "arxiv",
    "Decomposes benchmark saturation into noise floor and genuine progress; shows several popular benchmarks hit their noise floor 2 versions before saturation.",
    5, 5, 0.03, "research", true, null),
  mkItem(3, "demo-run-evals", "demo-skill-evals",
    "https://arxiv.org/abs/2609.28333",
    "Rubrics beat pairwise comparisons for open-ended model evals",
    "arxiv",
    "Shows rubric-based grading matches human agreement of pairwise judging at 60% of the cost, with better reproducibility across judge models.",
    5, 4, 0.04, "research", false, "outside top keep"),
  mkItem(4, "demo-run-evals", "demo-skill-evals",
    "https://arxiv.org/abs/2609.27000",
    "Position: all benchmarks are wrong, some are useful",
    "arxiv",
    "Position paper without experiments; broad claims about eval philosophy.",
    2, 2, 0.5, "opinion", false, "matches skill.skip (position paper without experiments)"),
];

function finishDemo(items: Item[]): Item[] {
  // run the real ranking code so kept flags + scores are consistent
  const keptTitles: string[] = [];
  const perSource = new Map<string, number>();
  const scored = items.map((it) => {
    const novel = !keptTitles.some((t) => titleSimilarity(t, it.title) > 0.6);
    const base = ((it.relevance ?? 0) / 4) * 0.55 + ((it.substance ?? 0) / 4) * 0.35 + (novel ? 1 : 0) * 0.1;
    it.score = base * (1 - (it.skip_p ?? 0));
    return it;
  });
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const it of scored) {
    if (it.drop_reason?.startsWith("matches skill.skip") || it.drop_reason?.includes("duplicate")) continue;
    const src = it.source;
    if ((perSource.get(src) ?? 0) < 2 && keptTitles.length < 6 && !it.drop_reason?.startsWith("outside") && !it.drop_reason?.includes("swapped")) {
      // keep demo-defined kept items as-is; just fill scores
    }
  }
  return items;
}

export const demoRuns: DemoRun[] = [
  {
    skillSlug: "ai-agents-digest",
    fetchedCount: 42,
    dedupedCount: 38,
    jevCount: 31,
    items: finishDemo(agentsItems),
    digest: {
      headline: "Agent infra grows up: durable state, honest evals, and one very expensive outage",
      bullets: [
        {
          text: "AgentGraph 2.0 ships checkpointed state machines for multi-agent workflows, cutting failed long-horizon runs by 40%.",
          item_url: "https://github.com/someorg/agentgraph/releases/tag/v2.0",
        },
        {
          text: "A contamination audit finds 23% of popular agent benchmarks leak solutions into training corpora; the paper proposes a tool-mutation protocol to catch it.",
          item_url: "https://arxiv.org/abs/2609.12345",
        },
        {
          text: "A production postmortem of 12k agent runs: loops spiral on ambiguous input; budget caps and step limits fixed most incidents.",
          item_url: "https://news.ycombinator.com/item?id=39111222",
        },
        {
          text: "An open-source eval harness replays historical support tickets against agent changes and diffs resolution rates.",
          item_url: "https://news.ycombinator.com/item?id=39108877",
        },
      ],
      full_read: {
        item_url: "https://arxiv.org/abs/2609.12345",
        why: "If only one thing shapes how you eval agents this year, make it contamination detection — the leak numbers are uncomfortable.",
      },
      themes: ["agent infrastructure", "evaluation", "production lessons"],
    },
  },
  {
    skillSlug: "indie-hacker-news",
    fetchedCount: 35,
    dedupedCount: 33,
    jevCount: 28,
    items: finishDemo(indieItems),
    digest: {
      headline: "Three honest numbers this morning: $6.2k MRR, $900 MRR, and a $5 changelog",
      bullets: [
        {
          text: "A chrome-extension founder charts 0 to $6.2k MRR in 8 months — including churn and the two channels that actually worked.",
          item_url: "https://news.ycombinator.com/item?id=39120101",
        },
        {
          text: "A postmortem on a SaaS that died at $900 MRR: pricing mistakes, single-channel dependence, support load.",
          item_url: "https://news.ycombinator.com/item?id=39119844",
        },
        {
          text: "New launch: a tiny tool that turns git logs into changelogs, free tier plus $5/mo pro, with live user feedback in the thread.",
          item_url: "https://news.ycombinator.com/item?id=39117555",
        },
      ],
      full_read: {
        item_url: "https://news.ycombinator.com/item?id=39119844",
        why: "Failure postmortems are rarer than success stories and the pricing mistakes are immediately actionable.",
      },
      themes: ["revenue", "postmortems", "launches"],
    },
  },
  {
    skillSlug: "llm-evals-arxiv",
    fetchedCount: 24,
    dedupedCount: 22,
    jevCount: 19,
    items: finishDemo(evalsItems),
    digest: {
      headline: "Eval methodology week: canaries, noise floors, and cheaper judging",
      bullets: [
        {
          text: "CheckMate-Bench plants cryptographic canaries in training corpora and introduces a contamination score with error bars across 9 models.",
          item_url: "https://arxiv.org/abs/2609.30101",
        },
        {
          text: "Saturation analysis shows several popular benchmarks hit their measurement noise floor two model versions before appearing to saturate.",
          item_url: "https://arxiv.org/abs/2609.29877",
        },
        {
          text: "Rubric-based grading matches pairwise-judging human agreement at 60% of the cost, with better cross-judge reproducibility.",
          item_url: "https://arxiv.org/abs/2609.28333",
        },
      ],
      full_read: {
        item_url: "https://arxiv.org/abs/2609.30101",
        why: "The contamination score is usable today — the appendix includes reference canary implementations.",
      },
      themes: ["contamination", "measurement noise", "judging methods"],
    },
  },
];

export function findDemoRun(skillSlug: string): DemoRun | undefined {
  return demoRuns.find((d) => d.skillSlug === skillSlug);
}
