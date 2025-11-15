import type { SupabaseClient } from "../_shared/supabase.ts";
import type { QuoteProvider, RemoteQuote } from "./handler.ts";

const MAX_SYMBOLS_PER_REQUEST = 10;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const COOKIE_URL = "https://fc.yahoo.com";
const CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const CREDENTIAL_TABLE = "service_credentials";
const CREDENTIAL_SERVICE_KEY = "yahoo_finance_quote_provider";
const DEFAULT_CREDENTIAL_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type YahooFinanceQuoteProviderDeps = {
  client?: SupabaseClient;
  cache?: CredentialCache;
  now?: () => Date;
  fetchFn?: typeof fetch;
  credentialTtlMs?: number;
};

type CredentialRecord = {
  cookie: string;
  crumb: string;
  expiresAt: string;
};

type ServiceCredentialRow = {
  service: string;
  cookie: string;
  crumb: string;
  expires_at: string;
};

interface CredentialCache {
  load(): Promise<CredentialRecord | null>;
  save(record: CredentialRecord): Promise<void>;
  invalidate(): Promise<void>;
}

class SupabaseCredentialCache implements CredentialCache {
  constructor(
    private readonly client: SupabaseClient,
    private readonly serviceKey: string = CREDENTIAL_SERVICE_KEY,
  ) {}

  async load(): Promise<CredentialRecord | null> {
    const { data, error } = await this.client
      .from(CREDENTIAL_TABLE)
      .select("cookie, crumb, expires_at")
      .eq("service", this.serviceKey)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new Error(`Failed to load cached credentials: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    const row = data as ServiceCredentialRow;
    return {
      cookie: row.cookie,
      crumb: row.crumb,
      expiresAt: row.expires_at,
    };
  }

  async save(record: CredentialRecord): Promise<void> {
    const { error } = await this.client.from(CREDENTIAL_TABLE).upsert({
      service: this.serviceKey,
      cookie: record.cookie,
      crumb: record.crumb,
      expires_at: record.expiresAt,
    });

    if (error) {
      throw new Error(`Failed to persist cached credentials: ${error.message}`);
    }
  }

  async invalidate(): Promise<void> {
    const { error } = await this.client
      .from(CREDENTIAL_TABLE)
      .delete()
      .eq("service", this.serviceKey);

    if (error) {
      throw new Error(`Failed to invalidate cached credentials: ${error.message}`);
    }
  }
}

/**
 * Yahoo Finance Quote Provider with database-backed cookie/crumb caching.
 */
export class YahooFinanceQuoteProvider implements QuoteProvider {
  private cookie: string | null = null;
  private crumb: string | null = null;
  private readonly cache: CredentialCache;
  private readonly now: () => Date;
  private readonly fetchFn: typeof fetch;
  private readonly credentialTtlMs: number;

  constructor(deps: YahooFinanceQuoteProviderDeps = {}) {
    if (!deps.cache && !deps.client) {
      throw new Error("YahooFinanceQuoteProvider requires a Supabase client or credential cache");
    }

    this.cache = deps.cache ?? new SupabaseCredentialCache(deps.client!);
    this.now = deps.now ?? (() => new Date());
    this.fetchFn = deps.fetchFn ?? fetch;
    this.credentialTtlMs = deps.credentialTtlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
  }

  async fetchQuotes(tickers: string[]): Promise<RemoteQuote[]> {
    const normalized = Array.from(new Set(tickers.map((ticker) => ticker.toUpperCase())));
    if (normalized.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    for (let i = 0; i < normalized.length; i += MAX_SYMBOLS_PER_REQUEST) {
      batches.push(normalized.slice(i, i + MAX_SYMBOLS_PER_REQUEST));
    }

    const results: RemoteQuote[] = [];
    for (const batch of batches) {
      const batchResults = await this.fetchBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async fetchBatch(symbols: string[], isRetry = false): Promise<RemoteQuote[]> {
    await this.ensureCredentials();

    const url = new URL(QUOTE_URL);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("formatted", "false");
    url.searchParams.set("crumb", this.crumb!);

    const response = await this.fetchFn(url.toString(), {
      headers: {
        Cookie: this.cookie!,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      if (isRetry) {
        throw new Error("Yahoo Finance authentication failed after retry");
      }

      await this.invalidateCredentials();
      return this.fetchBatch(symbols, true);
    }

    if (!response.ok) {
      throw new Error(`Yahoo Finance request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      quoteResponse?: { result?: Array<Record<string, unknown>> };
    };

    return this.parseQuoteResponse(payload, symbols);
  }

  private async ensureCredentials(): Promise<void> {
    if (this.cookie && this.crumb) {
      return;
    }

    if (await this.tryLoadFromCache()) {
      return;
    }

    await this.refreshCredentials();
  }

  private async tryLoadFromCache(): Promise<boolean> {
    try {
      const cached = await this.cache.load();
      if (!cached) {
        return false;
      }

      const expiresAt = Date.parse(cached.expiresAt);
      if (Number.isNaN(expiresAt) || expiresAt <= this.now().getTime()) {
        return false;
      }

      this.cookie = cached.cookie;
      this.crumb = cached.crumb;
      return true;
    } catch (error) {
      console.error("yahoo_finance: unable to load cached credentials", error);
      return false;
    }
  }

  private async refreshCredentials(): Promise<void> {
    const credentials = await this.fetchRemoteCredentials();
    this.cookie = credentials.cookie;
    this.crumb = credentials.crumb;

    const expiresAt = new Date(this.now().getTime() + this.credentialTtlMs).toISOString();
    try {
      await this.cache.save({ ...credentials, expiresAt });
    } catch (error) {
      console.error("yahoo_finance: failed to persist credentials", error);
    }
  }

  private async fetchRemoteCredentials(): Promise<{ cookie: string; crumb: string }> {
    let cookieResponse: Response;
    try {
      cookieResponse = await this.fetchFn(COOKIE_URL, {
        headers: {
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to request Yahoo Finance cookie: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const cookieHeader = cookieResponse.headers.get("set-cookie");
    const cookie = this.extractCookie(cookieHeader);
    if (!cookie) {
      throw new Error(
        `Failed to obtain Yahoo Finance cookie; status=${cookieResponse.status} headers=${
          cookieHeader ?? "<missing>"
        }`,
      );
    }

    let crumbResponse: Response;
    try {
      crumbResponse = await this.fetchFn(CRUMB_URL, {
        headers: {
          Cookie: cookie,
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to request Yahoo Finance crumb: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let crumb = (await crumbResponse.text()).trim();
    crumb = crumb.replace(/"/g, "");

    if (!crumb) {
      throw new Error(
        `Received empty crumb from Yahoo Finance; status=${crumbResponse.status}`,
      );
    }

    return { cookie, crumb };
  }

  private extractCookie(headerValue: string | null): string | null {
    if (!headerValue) {
      return null;
    }

    const match = headerValue.match(/A3=([^;]+)/);
    return match ? `A3=${match[1]}` : null;
  }

  private async invalidateCredentials(): Promise<void> {
    this.cookie = null;
    this.crumb = null;
    try {
      await this.cache.invalidate();
    } catch (error) {
      console.error("yahoo_finance: failed to invalidate cached credentials", error);
    }
  }

  private parseQuoteResponse(
    payload: { quoteResponse?: { result?: Array<Record<string, unknown>> } },
    expectedSymbols: string[],
  ): RemoteQuote[] {
    const quoteResults = payload.quoteResponse?.result ?? [];
    const results: RemoteQuote[] = [];

    for (const entry of quoteResults) {
      const ticker = typeof entry.symbol === "string" ? entry.symbol.toUpperCase() : null;
      if (!ticker || !expectedSymbols.includes(ticker)) continue;

      const price = typeof entry.regularMarketPrice === "number"
        ? entry.regularMarketPrice
        : typeof entry.postMarketPrice === "number"
        ? entry.postMarketPrice
        : typeof entry.preMarketPrice === "number"
        ? entry.preMarketPrice
        : null;

      if (price === null || Number.isNaN(price)) continue;

      const tsSeconds = typeof entry.regularMarketTime === "number"
        ? entry.regularMarketTime
        : typeof entry.postMarketTime === "number"
        ? entry.postMarketTime
        : typeof entry.preMarketTime === "number"
        ? entry.preMarketTime
        : null;

      const priceTime = tsSeconds
        ? new Date(tsSeconds * 1000).toISOString()
        : new Date().toISOString();

      const currency = typeof entry.currency === "string" && entry.currency.length > 0
        ? entry.currency
        : "USD";

      results.push({
        ticker,
        price,
        currency,
        priceTime,
        metadata: {
          exchange: entry.fullExchangeName ?? entry.exchange ?? null,
          marketState: entry.marketState ?? null,
        },
      });
    }

    return results;
  }
}
