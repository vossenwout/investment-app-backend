import type { SupabaseClient } from "../_shared/supabase.ts";
import { createServiceRoleClient, type EnvReader } from "../_shared/supabase.ts";

const DEFAULT_NASDAQ_DIRECTORY_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const DEFAULT_OTHERLISTED_DIRECTORY_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const UPSERT_BATCH_SIZE = 500;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export type ReferenceTicker = {
  ticker: string;
  name: string;
  exchange: string;
  asset_type: string | null;
  is_etf: boolean;
  source: string;
};

export type ReferenceTickerUpsert = ReferenceTicker & {
  is_active: boolean;
  last_seen_at: string;
};

export type HandlerDeps = {
  env?: EnvReader;
  client?: SupabaseClient;
  fetcher?: typeof fetch;
  now?: () => Date;
};

const OTHER_EXCHANGE_MAP: Record<string, string> = {
  A: "NYSE MKT",
  B: "NASDAQ BX",
  N: "NYSE",
  P: "NYSE ARCA",
  Z: "Cboe BZX",
  V: "IEX",
};

function response(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function parsePipeFile(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("File Creation Time"))
    .map((line) => line.split("|"));
}

export function parseNasdaqDirectory(text: string): ReferenceTicker[] {
  const rows = parsePipeFile(text);
  const result: ReferenceTicker[] = [];

  for (const row of rows) {
    if (!row[0] || row[0] === "Symbol") continue;
    const [
      symbol,
      securityName,
      _marketCategory,
      testIssue,
      _financialStatus,
      _roundLotSize,
      etfFlag,
      nextSharesFlag,
    ] = row;
    if (testIssue === "Y" || nextSharesFlag === "Y") continue;

    const ticker = symbol.trim().toUpperCase();
    if (!ticker) continue;

    const assetType = etfFlag === "Y" ? "ETF" : "EQUITY";

    result.push({
      ticker,
      name: (securityName ?? ticker).trim(),
      exchange: "NASDAQ",
      asset_type: assetType,
      is_etf: etfFlag === "Y",
      source: "nasdaq_directory",
    });
  }

  return result;
}

function mapOtherExchange(code: string | undefined): string {
  if (!code) return "UNKNOWN";
  return OTHER_EXCHANGE_MAP[code] ?? code;
}

export function parseOtherListedDirectory(text: string): ReferenceTicker[] {
  const rows = parsePipeFile(text);
  const result: ReferenceTicker[] = [];

  for (const row of rows) {
    if (!row[0] || row[0] === "ACT Symbol") continue;
    const [
      actSymbol,
      securityName,
      exchangeCode,
      cqsSymbol,
      etfFlag,
      _roundLot,
      testIssue,
      nasdaqSymbol,
    ] = row;
    if (testIssue === "Y") continue;

    const ticker = (actSymbol || cqsSymbol || nasdaqSymbol || "").trim().toUpperCase();
    if (!ticker) continue;

    result.push({
      ticker,
      name: (securityName ?? ticker).trim(),
      exchange: mapOtherExchange(exchangeCode),
      asset_type: etfFlag === "Y" ? "ETF" : "EQUITY",
      is_etf: etfFlag === "Y",
      source: "otherlisted_directory",
    });
  }

  return result;
}

export function mergeDirectoryTickers(...lists: ReferenceTicker[][]): ReferenceTicker[] {
  const map = new Map<string, ReferenceTicker>();
  for (const list of lists) {
    for (const entry of list) {
      if (!map.has(entry.ticker)) {
        map.set(entry.ticker, entry);
      }
    }
  }
  return Array.from(map.values());
}

async function downloadDirectory(fetcher: typeof fetch, url: string): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to download directory ${url} (status ${response.status})`);
  }
  return await response.text();
}

async function upsertReferenceTickers(
  client: SupabaseClient,
  rows: ReferenceTickerUpsert[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await client
      .from("reference_tickers")
      .upsert(chunk, { onConflict: "ticker" });
    if (error) {
      throw new Error(`Failed to upsert reference tickers: ${error.message}`);
    }
  }
}

export async function handleSyncReferenceTickers(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    const env = deps.env ?? Deno.env;
    const client = deps.client ?? createServiceRoleClient(env);
    const fetcher = deps.fetcher ?? fetch;
    const nowFactory = deps.now ?? (() => new Date());

    const nasdaqUrl = env.get("NASDAQ_DIRECTORY_URL") ?? DEFAULT_NASDAQ_DIRECTORY_URL;
    const otherUrl = env.get("OTHERLISTED_DIRECTORY_URL") ?? DEFAULT_OTHERLISTED_DIRECTORY_URL;

    const [nasdaqRaw, otherRaw] = await Promise.all([
      downloadDirectory(fetcher, nasdaqUrl),
      downloadDirectory(fetcher, otherUrl),
    ]);

    const nasdaqEntries = parseNasdaqDirectory(nasdaqRaw);
    const otherEntries = parseOtherListedDirectory(otherRaw);
    const merged = mergeDirectoryTickers(nasdaqEntries, otherEntries);

    const runTimestamp = nowFactory().toISOString();
    const upserts: ReferenceTickerUpsert[] = merged.map((entry) => ({
      ...entry,
      last_seen_at: runTimestamp,
      is_active: true,
    }));

    await upsertReferenceTickers(client, upserts);

    const { data: deactivatedRows, error: deactivateError } = await client
      .from("reference_tickers")
      .update({ is_active: false })
      .lt("last_seen_at", runTimestamp)
      .select("ticker");

    if (deactivateError) {
      throw new Error("Failed to deactivate stale tickers");
    }

    const deactivated = deactivatedRows?.length ?? 0;

    return response(200, {
      fetched: {
        nasdaq: nasdaqEntries.length,
        other: otherEntries.length,
      },
      upserts: upserts.length,
      deactivated,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return response(500, { error: message });
  }
}
