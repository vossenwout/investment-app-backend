import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.6";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.6";

export type { SupabaseClient };

export type EnvReader = Pick<typeof Deno.env, "get">;

export type IntOptions = {
  min?: number;
  max?: number;
};

export function createServiceRoleClient(env: EnvReader = Deno.env): SupabaseClient {
  // Check non-Docker URLs first, then fall back to Docker URLs
  const url = env.get("API_URL") ??
    env.get("SUPABASE_URL") ??
    env.get("EDGE_FUNCTION_API_URL") ??
    env.get("EDGE_FUNCTION_SUPABASE_URL");
  const serviceKey = env.get("SERVICE_ROLE_KEY") ??
    env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    env.get("EDGE_FUNCTION_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export function readIntFromEnv(
  env: EnvReader,
  key: string,
  fallback: number,
  options: IntOptions = {},
): number {
  const raw = env.get(key);
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  let value = Number.isFinite(parsed) ? parsed : fallback;

  if (options.min !== undefined) {
    value = Math.max(options.min, value);
  }

  if (options.max !== undefined) {
    value = Math.min(options.max, value);
  }

  return value;
}
