import type { SupabaseClient } from "../_shared/supabase.ts";
import { createServiceRoleClient, type EnvReader, readIntFromEnv } from "../_shared/supabase.ts";

const DEFAULT_METRICS_BATCH_SIZE = 50;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export type MetricsBatchConfig = {
  batchSize: number;
};

export type HandlerDeps = {
  env?: EnvReader;
  client?: SupabaseClient;
  now?: () => Date;
  config?: MetricsBatchConfig;
};

type StalePortfolioRow = { portfolio_id: string };

type PositionRow = {
  ticker: string;
  quantity: number | string;
  cost_basis: number | string | null;
};

type QuoteRow = {
  ticker: string;
  last_price: number | string | null;
};

export type CalculatedMetrics = {
  total_value: number;
  total_cost_basis: number;
  unrealized_gain: number;
  position_count: number;
  positions_missing_quotes: number;
};

export function resolveMetricsBatchConfig(env: EnvReader = Deno.env): MetricsBatchConfig {
  return {
    batchSize: readIntFromEnv(env, "METRICS_BATCH_SIZE", DEFAULT_METRICS_BATCH_SIZE, {
      min: 1,
      max: 500,
    }),
  };
}

function response(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function toNumber(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

export function calculatePortfolioMetrics(
  positions: PositionRow[],
  quotes: QuoteRow[],
): CalculatedMetrics {
  const priceMap = new Map(
    quotes.map((quote) => [
      quote.ticker.toUpperCase(),
      quote.last_price === null ? null : toNumber(quote.last_price),
    ]),
  );

  let totalValue = 0;
  let totalCost = 0;
  let missingQuotes = 0;

  for (const position of positions) {
    const ticker = position.ticker.toUpperCase();
    const quantity = toNumber(position.quantity);
    const costBasisPerShare = position.cost_basis === null ? 0 : toNumber(position.cost_basis);

    const price = priceMap.get(ticker);
    if (price === undefined || price === null) {
      missingQuotes += 1;
      totalValue += 0;
    } else {
      totalValue += quantity * price;
    }
    totalCost += quantity * costBasisPerShare;
  }

  const unrealized = totalValue - totalCost;

  return {
    total_value: Number(totalValue.toFixed(6)),
    total_cost_basis: Number(totalCost.toFixed(6)),
    unrealized_gain: Number(unrealized.toFixed(6)),
    position_count: positions.length,
    positions_missing_quotes: missingQuotes,
  };
}

async function selectStalePortfolios(
  client: SupabaseClient,
  batchSize: number,
): Promise<string[]> {
  const { data, error } = await client.rpc(
    "select_stale_portfolios",
    { p_batch_size: batchSize },
  );

  if (error) {
    throw new Error("Failed to load stale portfolio queue");
  }

  const rows = (data ?? []) as StalePortfolioRow[];
  return rows.map((row) => row.portfolio_id);
}

async function loadPortfolioPositions(
  client: SupabaseClient,
  portfolioId: string,
): Promise<PositionRow[]> {
  const { data, error } = await client
    .from("portfolio_positions")
    .select("ticker, quantity, cost_basis")
    .eq("portfolio_id", portfolioId);

  if (error || !data) {
    throw new Error(`Failed to load positions for portfolio ${portfolioId}`);
  }

  return data as PositionRow[];
}

async function loadQuotesForPositions(
  client: SupabaseClient,
  tickers: string[],
): Promise<QuoteRow[]> {
  if (tickers.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from("asset_quotes")
    .select("ticker, last_price")
    .in("ticker", tickers);

  if (error || !data) {
    throw new Error("Failed to load quotes for portfolio");
  }

  return data as QuoteRow[];
}

async function persistMetrics(
  client: SupabaseClient,
  portfolioId: string,
  metrics: CalculatedMetrics,
  asOfIso: string,
): Promise<void> {
  const { error } = await client
    .from("portfolio_metrics")
    .upsert({
      portfolio_id: portfolioId,
      metrics,
      as_of: asOfIso,
      stale: false,
      stale_reason: null,
    }, { onConflict: "portfolio_id" });

  if (error) {
    throw new Error(`Failed to persist metrics for portfolio ${portfolioId}`);
  }
}

async function recomputePortfolio(
  client: SupabaseClient,
  portfolioId: string,
  asOfIso: string,
): Promise<void> {
  const positions = await loadPortfolioPositions(client, portfolioId);
  const tickers = Array.from(new Set(positions.map((pos) => pos.ticker.toUpperCase())));
  const quotes = await loadQuotesForPositions(client, tickers);
  const metrics = calculatePortfolioMetrics(positions, quotes);
  await persistMetrics(client, portfolioId, metrics, asOfIso);
}

export async function handleRecalcMetricsBatch(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    const env = deps.env ?? Deno.env;
    const config = deps.config ?? resolveMetricsBatchConfig(env);
    const client = deps.client ?? createServiceRoleClient(env);
    const nowFactory = deps.now ?? (() => new Date());

    const batch = await selectStalePortfolios(client, config.batchSize);
    if (batch.length === 0) {
      return response(200, { processedPortfolios: 0, message: "No stale portfolios" });
    }

    const asOfIso = nowFactory().toISOString();
    let successes = 0;
    let failures = 0;
    for (const portfolioId of batch) {
      try {
        await recomputePortfolio(client, portfolioId, asOfIso);
        successes += 1;
      } catch (error) {
        failures += 1;
        console.error("recalc-metrics-batch: portfolio failed", { portfolioId, error });
        // Leave the portfolio stale so it can be retried on the next run.
      }
    }

    console.log(
      `recalc-metrics-batch processed=${batch.length} successes=${successes} failures=${failures}`,
    );
    return response(200, {
      processedPortfolios: batch.length,
      recalculated: successes,
      failed: failures,
    });
  } catch (error) {
    console.error("recalc-metrics-batch: unexpected error", error);
    return response(500, { error: "Unexpected server error" });
  }
}
