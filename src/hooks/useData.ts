import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Skill, Run, Digest } from "@/lib/types";

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("skills").select("*").order("created_at");
      if (cancelled) return;
      if (error) setError(error.message);
      else setSkills((data ?? []) as Skill[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { skills, loading, error };
}

export function useLatestRun(skillId: string | undefined) {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    if (!skillId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("runs")
        .select("*")
        .eq("skill_id", skillId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setRun((data as Run) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [skillId]);
  return run;
}

export function useLatestDigest(skillId: string | undefined) {
  const [digest, setDigest] = useState<Digest | null>(null);
  useEffect(() => {
    if (!skillId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("digests")
        .select("*")
        .eq("skill_id", skillId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setDigest((data as Digest) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [skillId]);
  return digest;
}
