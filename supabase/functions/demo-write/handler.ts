import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.6";

export type DemoMessageRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export interface DemoMessageRepo {
  insert(input: { content: string; metadata: Record<string, unknown> }): Promise<DemoMessageRow>;
}

export class SupabaseDemoMessageRepo implements DemoMessageRepo {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async insert(
    input: { content: string; metadata: Record<string, unknown> },
  ): Promise<DemoMessageRow> {
    const { data, error } = await this.#client
      .from("demo_messages")
      .insert({
        content: input.content,
        metadata: input.metadata,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Insert failed");
    }

    return data as DemoMessageRow;
  }
}

export function createRepoFromEnv(env: Pick<typeof Deno.env, "get"> = Deno.env): DemoMessageRepo {
  const url = env.get("EDGE_FUNCTION_API_URL") ??
    env.get("API_URL") ??
    env.get("EDGE_FUNCTION_SUPABASE_URL") ??
    env.get("SUPABASE_URL");
  const serviceKey = env.get("SERVICE_ROLE_KEY") ??
    env.get("EDGE_FUNCTION_SERVICE_ROLE_KEY") ??
    env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return new SupabaseDemoMessageRepo(client);
}

type DemoRequestBody = {
  content: unknown;
  metadata?: unknown;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function parseBody(body: DemoRequestBody): { content: string; metadata: Record<string, unknown> } {
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    throw new Error("`content` must be a non-empty string");
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      throw new Error("`metadata` must be an object if provided");
    }
    metadata = body.metadata as Record<string, unknown>;
  }

  return { content: body.content.trim(), metadata };
}

export async function handleDemoWriteRequest(
  request: Request,
  repo?: DemoMessageRepo,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: JSON_HEADERS },
    );
  }

  let parsedBody: DemoRequestBody;
  try {
    parsedBody = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  let input;
  try {
    input = parseBody(parsedBody);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const messageRepo = repo ?? createRepoFromEnv();

  try {
    const inserted = await messageRepo.insert(input);
    return new Response(
      JSON.stringify({
        id: inserted.id,
        content: inserted.content,
        created_at: inserted.created_at,
      }),
      { status: 201, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error("demo-write: insert failed", error);
    return new Response(
      JSON.stringify({ error: "Failed to persist message" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
}
