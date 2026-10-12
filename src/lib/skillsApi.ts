import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// Skill writes go through the save-skill Edge Function (service-role, validated);
// the anon key can only read the skills table.
export async function saveSkill<T = unknown>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke("save-skill", { body });
  if (!error) return { data: data as T, error: null };
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      if (payload && typeof payload.error === "string") return { data: null, error: payload.error };
    } catch {
      /* fall through to the generic message */
    }
  }
  return { data: null, error: error.message };
}
