// save-skill: create, edit and pause/resume skills with the service-role client.
// verify_jwt = true — the frontend calls it via supabase.functions.invoke.
// Replaces direct anon INSERT/UPDATE on `skills`, so config bounds and source
// URLs are validated server-side and only whitelisted columns are written.
import {
  corsHeaders,
  json,
  DAILY_LIMIT_BODY,
  HttpError,
  UUID_RE,
  isValidCron,
  readJsonBody,
} from "../_shared/deno-utils.ts";
import { serviceClient, tryIncrementUsage } from "../_shared/usage.ts";
import { SKILL_LIMITS, validateConfigForSave } from "../_shared/skill-config.ts";

const MAX_BODY_BYTES = 64 * 1024;
const EMPTY_CONFIG = { sources: [], keep: 6, cares_about: "", skip: "", output: "" };

function requireString(body: Record<string, unknown>, key: string, max: number): string {
  const v = body[key];
  if (typeof v !== "string") throw new HttpError(422, `${key} must be a string`);
  if (v.length > max) throw new HttpError(422, `${key} must be ${max} characters or fewer`);
  return v;
}

function requireId(body: Record<string, unknown>): string {
  const id = body.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new HttpError(400, "id must be a uuid");
  return id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const db = serviceClient();
    if (!db) return json({ error: "Service not configured" }, 503);

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const action = body.action;

    if (action === "create") {
      const markdown = requireString(body, "markdown", SKILL_LIMITS.markdown);
      // bound how many rows anonymous visitors can create per day
      const usage = await tryIncrementUsage(db, "save-skill-create");
      if ("error" in usage) return json({ error: "Usage counter unavailable — cannot proceed safely" }, 503);
      if ("over_cap" in usage) return json(DAILY_LIMIT_BODY, 429);

      const slug = `skill-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await db
        .from("skills")
        .insert({ slug, name: "Untitled skill", markdown, config: EMPTY_CONFIG, schedule: "0 7 * * *", active: false })
        .select()
        .maybeSingle();
      if (error || !data) {
        console.error("skill insert failed", error?.message);
        return json({ error: "could not create skill" }, 500);
      }
      return json({ skill: data });
    }

    if (action === "update") {
      const id = requireId(body);
      const markdown = requireString(body, "markdown", SKILL_LIMITS.markdown);
      const name = requireString(body, "name", SKILL_LIMITS.name);
      const schedule = requireString(body, "schedule", SKILL_LIMITS.schedule);
      if (!isValidCron(schedule)) return json({ error: "schedule must be a valid 5-field cron expression" }, 422);
      const config = validateConfigForSave(body.config);
      if (typeof config === "string") return json({ error: config }, 422);

      const { data, error } = await db
        .from("skills")
        .update({ markdown, name, schedule, config })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("skill update failed", error.message);
        return json({ error: "could not save skill" }, 500);
      }
      if (!data) return json({ error: "skill not found" }, 404);
      return json({ ok: true });
    }

    if (action === "set_active") {
      const id = requireId(body);
      if (typeof body.active !== "boolean") return json({ error: "active must be a boolean" }, 422);
      const { data, error } = await db
        .from("skills")
        .update({ active: body.active })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("skill set_active failed", error.message);
        return json({ error: "could not update skill" }, 500);
      }
      if (!data) return json({ error: "skill not found" }, 404);
      return json({ ok: true });
    }

    return json({ error: "action must be create, update or set_active" }, 400);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("save-skill error", (err as Error).message);
    return json({ error: "Internal error" }, 500);
  }
});
