import type { SupabaseClient } from "../_shared/supabase.ts";
import { createServiceRoleClient, type EnvReader, readIntFromEnv } from "../_shared/supabase.ts";
import { YahooFinanceQuoteProvider } from "./yahoo_finance.ts";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MIN_FETCH_INTERVAL_MINUTES = 30;
const DEFAULT_ERROR_BACKOFF_MINUTES = 60;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export type FetchBatchConfig = {
  batchSize: number;
  minFetchIntervalMinutes: number;
  errorBackoffMinutes: number;
};

export type HandlerDeps = {
  env?: EnvReader;
  client?: SupabaseClient;
  quoteProvider?: QuoteProvider;
  now?: () => Date;
  config?: FetchBatchConfig;
};

export function resolveFetchBatchConfig(env: EnvReader = Deno.env): FetchBatchConfig {
  return {
    batchSize: readIntFromEnv(env, "FETCH_BATCH_SIZE", DEFAULT_BATCH_SIZE, { min: 1, max: 500 }),
    minFetchIntervalMinutes: readIntFromEnv(
      env,
      "FETCH_MIN_FETCH_INTERVAL_MINUTES",
      DEFAULT_MIN_FETCH_INTERVAL_MINUTES,
      { min: 1, max: 24 * 60 },
    ),
    errorBackoffMinutes: readIntFromEnv(
      env,
      "FETCH_ERROR_BACKOFF_MINUTES",
      DEFAULT_ERROR_BACKOFF_MINUTES,
      { min: 1, max: 24 * 60 },
    ),
  };
}

type TickerRow = { ticker: string };

type QuoteUpsertInput = {
  ticker: string;
  currency: string;
  last_price: number;
  price_source: string;
  last_price_at: string;
  fetched_at: string;
  source_metadata: Record<string, unknown> | null;
};

export type RemoteQuote = {
  ticker: string;
  price: number;
  currency: string;
  priceTime: string;
  metadata: Record<string, unknown> | null;
};

export interface QuoteProvider {
  fetchQuotes(tickers: string[]): Promise<RemoteQuote[]>;
}

function response(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

async function selectTickers(client: SupabaseClient, config: FetchBatchConfig): Promise<string[]> {
  const { data, error } = await client.rpc("select_asset_tickers_for_fetch", {
    p_batch_size: config.batchSize,
    p_min_fetch_interval_minutes: config.minFetchIntervalMinutes,
  });

  if (error) {
    throw new Error("Failed to load tickers for fetch batch");
  }

  const rows = (data ?? []) as TickerRow[];
  return rows.map((row) => row.ticker.toUpperCase());
}

export function buildQuoteUpserts(quotes: RemoteQuote[], fetchedAtIso: string): QuoteUpsertInput[] {
  return quotes.map((quote) => ({
    ticker: quote.ticker,
    currency: quote.currency,
    last_price: quote.price,
    price_source: "yahoo_finance",
    last_price_at: quote.priceTime,
    fetched_at: fetchedAtIso,
    source_metadata: quote.metadata,
  }));
}

export function partitionTickers(
  allTickers: string[],
  returnedQuotes: RemoteQuote[],
): {
  succeeded: string[];
  missing: string[];
} {
  const returned = new Set(returnedQuotes.map((quote) => quote.ticker.toUpperCase()));
  const succeeded = allTickers.filter((ticker) => returned.has(ticker));
  const missing = allTickers.filter((ticker) => !returned.has(ticker));
  return { succeeded, missing };
}

async function upsertQuotes(client: SupabaseClient, upserts: QuoteUpsertInput[]): Promise<void> {
  if (upserts.length === 0) {
    return;
  }

  const { error } = await client.from("asset_quotes").upsert(upserts, { onConflict: "ticker" });

  if (error) {
    throw new Error("Failed to upsert asset quotes");
  }
}

async function updateTickerStatuses(
  client: SupabaseClient,
  tickers: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  if (tickers.length === 0) {
    return;
  }

  const { error } = await client.from("asset_tickers").update(payload).in("ticker", tickers);

  if (error) {
    throw new Error("Failed to update asset ticker metadata");
  }
}

async function markTickersErrored(
  client: SupabaseClient,
  tickers: string[],
  now: Date,
  backoffMinutes: number,
  reason: string,
): Promise<void> {
  if (tickers.length === 0) return;

  const retryAfter = new Date(now.getTime() + backoffMinutes * 60 * 1000).toISOString();
  await updateTickerStatuses(client, tickers, {
    last_fetch_error: reason,
    retry_after: retryAfter,
  });
}

async function markPortfoliosStale(client: SupabaseClient, tickers: string[]): Promise<number> {
  if (tickers.length === 0) {
    return 0;
  }

  const { data: portfolios, error: selectError } = await client
    .from("portfolio_positions")
    .select("portfolio_id")
    .in("ticker", tickers);

  if (selectError) {
    throw new Error("Failed to resolve affected portfolios");
  }

  const portfolioIds = Array.from(
    new Set((portfolios ?? []).map((row: { portfolio_id: string }) => row.portfolio_id)),
  );
  if (portfolioIds.length === 0) {
    return 0;
  }

  const result = await client.from("portfolio_metrics").upsert(
    portfolioIds.map((id) => ({
      portfolio_id: id,
      stale: true,
      stale_reason: "prices_updated",
    })),
    { onConflict: "portfolio_id" },
  );

  if (result.error) {
    throw new Error("Failed to mark portfolios as stale");
  }

  return portfolioIds.length;
}

export async function handleFetchPricesBatch(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    const env = deps.env ?? Deno.env;
    const config = deps.config ?? resolveFetchBatchConfig(env);
    const client = deps.client ?? createServiceRoleClient(env);
    const quoteProvider = deps.quoteProvider ?? new YahooFinanceQuoteProvider({ client });
    const nowFactory = deps.now ?? (() => new Date());

    const tickers = await selectTickers(client, config);
    if (tickers.length === 0) {
      return response(200, {
        processedTickers: 0,
        updatedTickers: 0,
        missingTickers: 0,
        stalePortfolios: 0,
      });
    }

    const now = nowFactory();
    let remoteQuotes: RemoteQuote[] = [];
    try {
      remoteQuotes = await quoteProvider.fetchQuotes(tickers);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Quote refresh failed";
      await markTickersErrored(client, tickers, now, config.errorBackoffMinutes, reason);
      console.error("fetch-prices-batch: quote provider failed", error);
      return response(502, { error: reason, processedTickers: tickers.length });
    }

    const upserts = buildQuoteUpserts(remoteQuotes, now.toISOString());
    await upsertQuotes(client, upserts);

    const { succeeded, missing } = partitionTickers(tickers, remoteQuotes);
    await updateTickerStatuses(client, succeeded, {
      last_fetched_at: now.toISOString(),
      last_fetch_error: null,
      retry_after: null,
    });
    await markTickersErrored(
      client,
      missing,
      now,
      config.errorBackoffMinutes,
      "Quote not returned",
    );
    // should this really be done here?
    const stalePortfolios = await markPortfoliosStale(client, succeeded);
    console.log(
      `fetch-prices-batch processed=${tickers.length} updated=${succeeded.length} missing=${missing.length} portfolios=${stalePortfolios}`,
    );

    return response(200, {
      processedTickers: tickers.length,
      updatedTickers: succeeded.length,
      missingTickers: missing.length,
      stalePortfolios,
    });
  } catch (error) {
    console.error("fetch-prices-batch: unexpected error", error);
    return response(500, { error: "Unexpected server error" });
  }
}
