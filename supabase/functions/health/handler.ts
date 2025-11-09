export type HealthPayload = {
  status: "ok";
  timestamp: string;
  version: string;
  region: string;
};

const HEADER_JSON = { "content-type": "application/json; charset=utf-8" };

function nowIso(): string {
  return new Date().toISOString();
}

export function buildHealthPayload(env: Pick<typeof Deno.env, "get"> = Deno.env): HealthPayload {
  return {
    status: "ok",
    timestamp: nowIso(),
    version: env.get("APP_VERSION") ?? "dev",
    region: env.get("SUPABASE_REGION") ?? "local",
  };
}

export function handleHealthRequest(request: Request): Response {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: HEADER_JSON },
    );
  }

  const payload = buildHealthPayload();
  return new Response(JSON.stringify(payload), {
    headers: {
      ...HEADER_JSON,
      "cache-control": "no-store",
    },
  });
}
