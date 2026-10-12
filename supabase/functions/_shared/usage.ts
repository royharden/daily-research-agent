// Service-role client + daily usage counter shared by all edge functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { DAILY_CAP } from "./deno-utils.ts";

/** Service-role client built only from env. Null when either env var is missing (callers return 503). */
export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Daily cap, overridable with the DAILY_CALL_LIMIT secret. */
export function dailyCap(): number {
  const raw = Deno.env.get("DAILY_CALL_LIMIT");
  if (!raw) return DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DAILY_CAP;
}

export type UsageResult = { ok: true; calls: number } | { over_cap: true } | { error: string };

/**
 * Atomically reserve `units` against today's cap for `fn`. Fails closed: an RPC
 * error, a null/missing result or a non-integer result is reported as an error.
 */
export async function tryIncrementUsage(db: SupabaseClient, fn: string, units = 1): Promise<UsageResult> {
  try {
    const { data, error } = await db.rpc("increment_usage_by", { fn_name: fn, units, cap: dailyCap() });
    if (error) {
      console.error("usage rpc error", fn, error.message);
      return { error: "usage rpc error" };
    }
    if (data === -1) return { over_cap: true };
    if (typeof data !== "number" || !Number.isInteger(data) || data < units) {
      console.error("usage rpc returned an unexpected result", fn, data);
      return { error: "usage rpc returned an unexpected result" };
    }
    return { ok: true, calls: data };
  } catch (e) {
    console.error("usage rpc threw", fn, (e as Error).message);
    return { error: "usage rpc threw" };
  }
}
