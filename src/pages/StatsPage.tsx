import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { Coins, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Run } from "@/lib/types";
import { LLM_TOKENS_PER_ITEM, JEV_TOKENS_PER_ITEM, LLM_COST_PER_MTOK, JEV_COST_PER_MTOK } from "@/lib/ranking";

export default function StatsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(200);
      setRuns((data ?? []) as Run[]);
      setLoading(false);
    })();
  }, []);

  const perDay = new Map<string, { runs: number; fetched: number; kept: number; cost: number; sent: number }>();
  for (const r of runs) {
    const day = r.started_at.slice(0, 10);
    const e = perDay.get(day) ?? { runs: 0, fetched: 0, kept: 0, cost: 0, sent: 0 };
    e.runs += 1;
    e.fetched += r.counts?.fetched ?? 0;
    e.kept += r.counts?.kept ?? 0;
    e.sent += r.counts?.sent_to_jev ?? 0;
    e.cost += Number(r.jev_cost_usd ?? 0);
    perDay.set(day, e);
  }
  const chartData = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, e]) => ({
      day: day.slice(5),
      runs: e.runs,
      fetched: e.fetched,
      kept: e.kept,
      jevCost: Number(e.cost.toFixed(6)),
      llmOnlyCost: Number((((e.fetched * LLM_TOKENS_PER_ITEM * LLM_COST_PER_MTOK) / 1e6)).toFixed(4)),
      tokensSaved: Math.max(0, e.fetched * LLM_TOKENS_PER_ITEM - (e.sent * JEV_TOKENS_PER_ITEM + e.kept * LLM_TOKENS_PER_ITEM)),
    }));

  const totalSaved = chartData.reduce((s, d) => s + d.tokensSaved, 0);
  const totalJev = chartData.reduce((s, d) => s + d.jevCost, 0);
  const totalLlmOnly = chartData.reduce((s, d) => s + d.llmOnlyCost, 0);

  return (
    <div>
      <h1 className="headline-serif text-2xl mb-1">Stats</h1>
      <p className="text-sm text-ink-500 dark:text-paper-300 mb-6">
        Fetch wide, filter cheaply, write only what matters. Token constants are editable in the ranking module.
      </p>

      {loading ? (
        <div className="text-center text-ink-400 py-12">Loading…</div>
      ) : chartData.length === 0 ? (
        <div className="card p-8 text-center text-ink-500">No runs recorded yet. Run a skill to see stats here.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={<Zap size={16} />} label="Tokens saved (est.)" value={totalSaved.toLocaleString()} sub="vs. sending everything to the LLM" />
            <StatCard icon={<Coins size={16} />} label="Jev cost (total)" value={`$${totalJev.toFixed(4)}`} sub={`vs. $${totalLlmOnly.toFixed(2)} LLM-only estimate`} />
            <StatCard icon={<Zap size={16} />} label="Keep rate" value={pct(chartData)} sub="kept / fetched across all runs" />
          </div>

          <div className="card p-5">
            <h2 className="headline-serif text-lg mb-3">Runs per day</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="runs" fill="#2d6f4c" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h2 className="headline-serif text-lg mb-3">Items fetched vs. kept</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="fetched" fill="#8f8871" radius={4} />
                <Bar dataKey="kept" fill="#3d8a61" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h2 className="headline-serif text-lg mb-3">Jev cost vs. estimated LLM-only cost (USD)</h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="jevCost" stroke="#2d6f4c" strokeWidth={2} name="Jev" />
                <Line type="monotone" dataKey="llmOnlyCost" stroke="#b56b14" strokeWidth={2} strokeDasharray="4 3" name="LLM-only (est.)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function pct(chartData: { fetched: number; kept: number }[]): string {
  const f = chartData.reduce((s, d) => s + d.fetched, 0);
  const k = chartData.reduce((s, d) => s + d.kept, 0);
  return f ? `${Math.round((k / f) * 100)}%` : "—";
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-xs text-ink-400 dark:text-paper-400 mb-1">
        <span className="text-moss-600 dark:text-moss-400">{icon}</span> {label}
      </div>
      <div className="headline-serif text-2xl">{value}</div>
      <div className="text-xs text-ink-400 dark:text-paper-400 mt-1">{sub}</div>
    </div>
  );
}
