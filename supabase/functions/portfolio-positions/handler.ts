import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.6";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PortfolioPositionRow = {
  id: string;
  portfolio_id: string;
  ticker: string;
  quantity: number;
  cost_basis: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertPositionInput = {
  portfolioId: string;
  ticker: string;
  quantity: number;
  costBasis: number | null;
  notes: string | null;
};

export interface PortfolioPositionRepo {
  ensurePortfolioOwnership(portfolioId: string, userId: string): Promise<void>;
  upsertPosition(input: UpsertPositionInput): Promise<PortfolioPositionRow>;
  deletePosition(portfolioId: string, ticker: string): Promise<void>;
}

export interface AuthService {
  resolveUserId(authorizationHeader: string | null): Promise<string>;
}

export class SupabasePortfolioPositionRepo implements PortfolioPositionRepo {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async ensurePortfolioOwnership(portfolioId: string, userId: string): Promise<void> {
    const { data, error } = await this.#client
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId)
      .eq("owner_id", userId)
      .single();

    if (error || !data) {
      throw new HttpError(404, "Portfolio not found");
    }
  }

  async upsertPosition(input: UpsertPositionInput): Promise<PortfolioPositionRow> {
    const { data, error } = await this.#client
      .from("portfolio_positions")
      .upsert({
        portfolio_id: input.portfolioId,
        ticker: input.ticker,
        quantity: input.quantity,
        cost_basis: input.costBasis,
        notes: input.notes,
      }, { onConflict: "portfolio_id,ticker" })
      .select("*")
      .single();

    if (error || !data) {
      throw new HttpError(500, "Failed to persist portfolio position");
    }

    return data as PortfolioPositionRow;
  }

  async deletePosition(portfolioId: string, ticker: string): Promise<void> {
    const { data, error } = await this.#client
      .from("portfolio_positions")
      .delete()
      .eq("portfolio_id", portfolioId)
      .eq("ticker", ticker)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Failed to delete portfolio position");
    }

    if (!data) {
      throw new HttpError(404, "Position not found");
    }
  }
}

export class SupabaseAuthService implements AuthService {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async resolveUserId(authorizationHeader: string | null): Promise<string> {
    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing bearer token");
    }

    const token = authorizationHeader.split(" ")[1]?.trim();
    if (!token) {
      throw new HttpError(401, "Invalid bearer token");
    }

    const { data, error } = await this.#client.auth.getUser(token);
    if (error || !data.user) {
      throw new HttpError(401, "Invalid or expired session");
    }

    return data.user.id;
  }
}

export function createClientFromEnv(env: Pick<typeof Deno.env, "get"> = Deno.env): SupabaseClient {
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

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type AddPositionBody = {
  portfolioId?: unknown;
  ticker?: unknown;
  quantity?: unknown;
  costBasis?: unknown;
  notes?: unknown;
};

type RemovePositionBody = {
  portfolioId?: unknown;
  ticker?: unknown;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeTicker(rawTicker: string): string {
  return rawTicker.trim().toUpperCase();
}

function parseUpsertBody(body: AddPositionBody): UpsertPositionInput {
  if (typeof body.portfolioId !== "string" || !isUuid(body.portfolioId)) {
    throw new HttpError(400, "`portfolioId` must be a valid UUID string");
  }

  if (typeof body.ticker !== "string" || body.ticker.trim().length === 0) {
    throw new HttpError(400, "`ticker` must be a non-empty string");
  }

  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity <= 0) {
    throw new HttpError(400, "`quantity` must be a number greater than 0");
  }

  let costBasis: number | null = null;
  if (body.costBasis !== undefined && body.costBasis !== null) {
    if (
      typeof body.costBasis !== "number" || !Number.isFinite(body.costBasis) || body.costBasis < 0
    ) {
      throw new HttpError(400, "`costBasis` must be a non-negative number");
    }
    costBasis = body.costBasis;
  }

  let notes: string | null = null;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") {
      throw new HttpError(400, "`notes` must be a string when provided");
    }
    const trimmed = body.notes.trim();
    if (trimmed.length > 512) {
      throw new HttpError(400, "`notes` must be 512 characters or fewer");
    }
    notes = trimmed.length > 0 ? trimmed : null;
  }

  const ticker = normalizeTicker(body.ticker);
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    throw new HttpError(400, "`ticker` may only include letters, numbers, dots, or dashes");
  }

  return {
    portfolioId: body.portfolioId,
    ticker,
    quantity: body.quantity,
    costBasis,
    notes,
  };
}

function parseRemoveBody(body: RemovePositionBody): { portfolioId: string; ticker: string } {
  if (typeof body.portfolioId !== "string" || !isUuid(body.portfolioId)) {
    throw new HttpError(400, "`portfolioId` must be a valid UUID string");
  }

  if (typeof body.ticker !== "string" || body.ticker.trim().length === 0) {
    throw new HttpError(400, "`ticker` must be a non-empty string");
  }

  const ticker = normalizeTicker(body.ticker);
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    throw new HttpError(400, "`ticker` may only include letters, numbers, dots, or dashes");
  }

  return { portfolioId: body.portfolioId, ticker };
}

type HandlerDeps = {
  repo?: PortfolioPositionRepo;
  authService?: AuthService;
};

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function response(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return response({ error: error.message }, error.status);
  }
  console.error("portfolio-positions: unexpected error", error);
  return response({ error: "Unexpected server error" }, 500);
}

export async function handlePortfolioPositionsRequest(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  try {
    let client: SupabaseClient | undefined;
    if (!deps.repo || !deps.authService) {
      client = createClientFromEnv();
    }
    const repo = deps.repo ?? new SupabasePortfolioPositionRepo(client!);
    const authService = deps.authService ?? new SupabaseAuthService(client!);
    const userId = await authService.resolveUserId(request.headers.get("Authorization"));

    if (request.method === "POST") {
      const parsed = parseUpsertBody(await parseJson(request) as AddPositionBody);
      await repo.ensurePortfolioOwnership(parsed.portfolioId, userId);
      const position = await repo.upsertPosition(parsed);
      return response({ position }, 201);
    }

    if (request.method === "DELETE") {
      const parsed = parseRemoveBody(await parseJson(request) as RemovePositionBody);
      await repo.ensurePortfolioOwnership(parsed.portfolioId, userId);
      await repo.deletePosition(parsed.portfolioId, parsed.ticker);
      return response({ status: "deleted" }, 200);
    }

    return response({ error: "Method not allowed" }, 405);
  } catch (error) {
    return handleError(error);
  }
}
