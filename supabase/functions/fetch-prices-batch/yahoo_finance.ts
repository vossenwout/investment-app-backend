import type { QuoteProvider, RemoteQuote } from "./handler.ts";

const MAX_SYMBOLS_PER_REQUEST = 10;

/**
 * Yahoo Finance Quote Provider with cookie/crumb authentication.
 *
 * Yahoo Finance requires a cookie and crumb for authenticated requests.
 * This provider handles initialization, authentication, and automatic retry
 * when credentials expire.
 */
export class YahooFinanceQuoteProvider implements QuoteProvider {
  private cookie: string | null = null;
  private crumb: string | null = null;

  /**
   * Initialize authentication by fetching cookie and crumb from Yahoo Finance.
   */
  private async init(): Promise<void> {
    // Step 1: Get cookie from Yahoo Finance
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    // Extract A3 cookie from response
    const cookies = cookieResponse.headers.get("set-cookie");
    if (cookies) {
      const a3Match = cookies.match(/A3=([^;]+)/);
      if (a3Match) {
        this.cookie = `A3=${a3Match[1]}`;
      }
    }

    if (!this.cookie) {
      throw new Error("Failed to obtain Yahoo Finance cookie");
    }

    // Step 2: Get crumb for authenticated requests
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        Cookie: this.cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!crumbResponse.ok) {
      throw new Error(`Failed to obtain Yahoo Finance crumb: ${crumbResponse.status}`);
    }

    this.crumb = await crumbResponse.text();
    // Remove quotes if present
    this.crumb = this.crumb.replace(/"/g, "");
  }

  /**
   * Fetch quotes for multiple tickers from Yahoo Finance.
   * Automatically handles authentication and retries on auth failure.
   */
  async fetchQuotes(tickers: string[]): Promise<RemoteQuote[]> {
    const normalized = Array.from(new Set(tickers.map((ticker) => ticker.toUpperCase())));
    if (normalized.length === 0) {
      return [];
    }

    // Split into batches to respect Yahoo Finance limits
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

  /**
   * Fetch a single batch of quotes.
   * Handles automatic retry on 401 (authentication expired).
   */
  private async fetchBatch(symbols: string[], isRetry = false): Promise<RemoteQuote[]> {
    // Initialize if not already done
    if (!this.cookie || !this.crumb) {
      await this.init();
    }

    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("formatted", "false");
    url.searchParams.set("crumb", this.crumb!);

    const response = await fetch(url.toString(), {
      headers: {
        Cookie: this.cookie!,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    // Handle authentication expiry
    if (response.status === 401) {
      if (isRetry) {
        throw new Error("Yahoo Finance authentication failed after retry");
      }
      // Cookie/crumb expired, refresh and retry
      this.cookie = null;
      this.crumb = null;
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

  /**
   * Parse Yahoo Finance API response into RemoteQuote objects.
   */
  private parseQuoteResponse(
    payload: { quoteResponse?: { result?: Array<Record<string, unknown>> } },
    expectedSymbols: string[],
  ): RemoteQuote[] {
    const quoteResults = payload.quoteResponse?.result ?? [];
    const results: RemoteQuote[] = [];

    for (const entry of quoteResults) {
      const ticker = typeof entry.symbol === "string" ? entry.symbol.toUpperCase() : null;
      if (!ticker || !expectedSymbols.includes(ticker)) continue;

      // Try to get price from regular market, post market, or pre market
      const price = typeof entry.regularMarketPrice === "number"
        ? entry.regularMarketPrice
        : typeof entry.postMarketPrice === "number"
        ? entry.postMarketPrice
        : typeof entry.preMarketPrice === "number"
        ? entry.preMarketPrice
        : null;

      if (price === null || Number.isNaN(price)) continue;

      // Get timestamp for the price
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
